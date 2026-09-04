/**
 * サンドボックス。**AIを隔離された場所で動かす。**
 *
 * `autodrive.json` が `sandbox: devcontainer` と記録していても、置かれるものが
 * 無ければ隔離されない。**記録しているのに置いていない状態**を塞ぐ（AUT-95）。
 *
 * ## 許可する宛先は、構成から決まる
 *
 * **使わないものへの穴を開けない。** Tracker に Linear を使っていなければ
 * `api.linear.app` は要らないし、Preview を使っていなければプレビューの宛先も
 * 要らない。構成に無いものを許可すると、**閉じている理由が薄れる。**
 *
 * **ワイルドカードは書けない。** 規則は名前解決した IP に対して置かれるため、
 * `*.workers.dev` のような書き方はできない。宛先ごとに1行が要る。配布先が増える
 * たびに手が要るが、**そこが判断の機会になる。**
 *
 * ## 一覧に無い宛先でも、出られることがある
 *
 * 同じ理由から、**許可した宛先と同じ IP を共有する宛先へは、一覧に無くても出られる。**
 * IP では、その先にある名前を区別できないためである。
 *
 * 実際に測った（AUT-122）。出口制限が効いている状態で、`raw.githubusercontent.com`
 * と `gist.githubusercontent.com` は一覧に無いのに出られた。許可している
 * `objects.githubusercontent.com` と同じ IP だったため。`example.com` は塞がった。
 *
 * **一覧の書き方では解けない。** 名前で判定するには、間に代理を置いて宛先名を見る
 * 必要がある（`CONNECT` の宛先や SNI で足り、中身は見なくてよい）。それは別の
 * 仕掛けであり、ここでは持たない。
 *
 * **したがって「ここに無い宛先へは出られない」と書かないこと。** 書いていた。
 *
 * ## アプリ自身の宛先も、構成から来る
 *
 * ポートの宛先はどのプロジェクトでも同じだが、作っているものが自分で叩く先は
 * プロジェクト固有である。`app.destinations` がそれにあたる。
 *
 * **以前は「ここへ足すこと」と書いていた。そして `update` で消していた**（AUT-115）。
 * 許可一覧は `managed` であり、丸ごと書き直される。消えると出口が閉じるため、
 * **動いていたものが入れ替えで止まり、止まった理由が結びつかない。**
 */

/** @typedef {{ host: string, why: string }} Destination */
/** どの構成でも要るもの。**AIが動かなければ何も始まらない。** */
const ALWAYS = [
  { host: "api.anthropic.com", why: "推論" },
  { host: "console.anthropic.com", why: "認証" },
  { host: "statsig.anthropic.com", why: "機能フラグ（CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC で止まる）" },
  { host: "registry.npmjs.org", why: "依存の取得" },
  { host: "deb.debian.org", why: "コンテナ内のパッケージ" },
  { host: "security.debian.org", why: "同上" },
];

/**
 * ポートの実装ごとに要る宛先。
 *
 * **実装名で引く。** ポート名で引くと、実装を差し替えたときに宛先が付いてくる。
 */
const FOR_IMPLEMENTATION = {
  github: [
    { host: "github.com", why: "clone / push" },
    { host: "api.github.com", why: "提出、実行結果の取得" },
    { host: "codeload.github.com", why: "アーカイブの取得" },
    { host: "objects.githubusercontent.com", why: "大きなオブジェクト" },
    // **無いと CI の失敗を自分で追えない。** 人に貼ってもらうか手元で再現するか
    // しかなく、そのぶん人の手間になる。
    { host: "results-receiver.actions.githubusercontent.com", why: "実行結果のログ本文" },
    { host: "ghcr.io", why: "devcontainer feature の取得" },
    { host: "pkg-containers.githubusercontent.com", why: "同上" },
  ],
  linear: [{ host: "api.linear.app", why: "作業単位の取得・起票・状態の更新" }],
  "cloudflare-workers": [
    { host: "api.cloudflare.com", why: "配布先の状態の確認" },
    // **記憶で答えないために要る。** 読み取り専用の公式文書であり、資格情報は
    // 関わらない。記憶で書いて外した実例がある。
    { host: "developers.cloudflare.com", why: "仕様の確認" },
  ],
};

/** 構成から、許可する宛先を組み立てる。**重複は落とす。** */
export function destinationsFor(config) {
  const out = [...ALWAYS];
  const seen = new Set(out.map((d) => d.host));

  for (const port of Object.keys(config.ports) ) {
    // **使わないポート（`none`）は表に無いため、何も足さない。**
    // 実装名で引くので、実装ごとの宛先だけが入る。
    for (const d of FOR_IMPLEMENTATION[config.ports[port]] ?? []) {
      if (seen.has(d.host)) continue;
      seen.add(d.host);
      out.push(d);
    }
  }

  // **アプリ自身の宛先を、最後に足す。** ポートの宛先はどのプロジェクトでも同じだが、
  // これはこのプロジェクト固有である。分けて並べると、どこまでが道具の都合で、
  // どこからが作っているものの都合かが読み取れる。
  for (const d of config.app?.destinations ?? []) {
    if (seen.has(d.host)) continue;
    seen.add(d.host);
    out.push({ ...d, ofApp: true });
  }
  return out;
}

/**
 * 許可一覧を書き出す。
 *
 * **なぜ要るのかを併記する。** 書けないなら要らない可能性が高い。後から読む人が
 * 消してよいかを判断できる。
 */
export function allowedDomains(config) {
  const lines = [
    "# 外向き通信を許可する宛先。",
    "#",
    "# **ここに無い宛先の多くは塞がる。ただし全部ではない。**",
    "#",
    "# 規則は名前解決した IP に対して置かれる。したがって、**許可した宛先と同じ IP を",
    "# 共有する宛先へは、ここに無くても出られる。** 同じ CDN やホスティングの背後に",
    "# あるものが該当する。実際に測った例:",
    "#",
    "#   objects.githubusercontent.com   一覧にある   出られる",
    "#   raw.githubusercontent.com       一覧に無い   **出られる**（同じ IP）",
    "#   example.com                     一覧に無い   塞がる（別の IP）",
    "#",
    "# **これを、データが外へ出ないことの保証として扱わないこと。** 出られる先を",
    "# 減らす仕掛けであって、閉じる仕掛けではない。**本当に守っているのは、手元に",
    "# 資格情報を置かないことと、固定条件で止まることである。**",
    "#",
    "# 追加するときは、なぜ要るのかを併記すること。書けないなら要らない可能性が高い。",
    "#",
    "# **ワイルドカードは書けない。** 同じ理由による。サブドメインごとに1行が要る。",
    "#",
    "# **この一覧は構成（autodrive.json）から作られている。** 使わないポートの宛先は",
    "# 入っていない。構成を変えたら `autodrive-dev-kit update` を打ち直すこと。",
    "",
  ];

  const all = destinationsFor(config);
  const width = Math.max(...all.map((d) => d.host.length));

  let started = false;
  for (const d of all) {
    // **アプリ自身のものは、見出しを立てて分ける。** 混ぜると、道具のために開いて
    // いる穴なのか、作っているもののために開いている穴なのかが読み取れない。
    if (d.ofApp === true && !started) {
      started = true;
      lines.push("", "# ここから下は、このプロジェクト自身の宛先。");
    }
    lines.push(`${d.host.padEnd(width)}  # ${d.why}`);
  }

  // **ここへ直接書けと言わないこと。** 言っていた。そして `update` で消していた。
  // 書けと言った場所が、書いたものを消していた（AUT-115）。
  lines.push(
    "",
    "# 配布先や、このアプリが叩く先を足すときは、**このファイルを直接編集しないこと。**",
    "# ここは構成から作られており、`update` のたびに書き直される。",
    "#",
    "# autodrive.json の app.destinations に足して、`autodrive-dev-kit update` を打つこと。",
    "#   { \"host\": \"example.workers.dev\", \"why\": \"配布先の疎通確認\" }",
    "#",
    "# **宛先ごとに1行が要る。** 手が要るが、そこが判断の機会になる。",
  );
  return `${lines.join("\n")}\n`;
}
