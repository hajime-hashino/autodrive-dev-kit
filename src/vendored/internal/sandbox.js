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
  { host: "api.anthropic.com", why: "Inference" },
  { host: "console.anthropic.com", why: "Authentication" },
  { host: "statsig.anthropic.com", why: "Feature flags (stopped by CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)" },
  { host: "registry.npmjs.org", why: "Fetching dependencies" },
  { host: "deb.debian.org", why: "Packages inside the container" },
  { host: "security.debian.org", why: "Same as above" },
];

/**
 * ポートの実装ごとに要る宛先。
 *
 * **実装名で引く。** ポート名で引くと、実装を差し替えたときに宛先が付いてくる。
 */
const FOR_IMPLEMENTATION = {
  github: [
    { host: "github.com", why: "clone / push" },
    { host: "api.github.com", why: "Submissions, fetching run results" },
    { host: "codeload.github.com", why: "Fetching archives" },
    { host: "objects.githubusercontent.com", why: "Large objects" },
    // **無いと CI の失敗を自分で追えない。** 人に貼ってもらうか手元で再現するか
    // しかなく、そのぶん人の手間になる。
    //
    // **読むのは `gh run view --log-failed` である。** REST の
    // `/actions/jobs/{id}/logs` は Azure の blob へ転送され、そのホスト名は
    // 実行ごとに変わる（実測で `productionresultssa0/5/6/12/13/18/19`）。
    // **ワイルドカードは書けないので、一覧では届かない**（AUT-161）。
    { host: "results-receiver.actions.githubusercontent.com", why: "Log bodies of run results" },
    { host: "ghcr.io", why: "Fetching devcontainer features" },
    { host: "pkg-containers.githubusercontent.com", why: "Same as above" },
  ],
  linear: [{ host: "api.linear.app", why: "Getting, filing, and updating the status of work items" }],
  // **Repo に GitHub を使っていなくても要る。** 作業単位だけ GitHub に置く構成が
  // ありうる。重複は落とされるので、両方に書いても一覧は増えない。
  "github-issues": [{ host: "api.github.com", why: "Getting, filing, and updating the status of work items" }],
  "cloudflare-workers": [
    { host: "api.cloudflare.com", why: "Checking the state of the deployment target" },
    // **記憶で答えないために要る。** 読み取り専用の公式文書であり、資格情報は
    // 関わらない。記憶で書いて外した実例がある。
    { host: "developers.cloudflare.com", why: "Checking the specification" },
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
  // これはこのプロジェクト固有である。分けて並べると、どこまでが autodrive-dev-kit の都合で、
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
    "# Destinations allowed for outbound traffic.",
    "#",
    "# **Most destinations not listed here are blocked. But not all.**",
    "#",
    "# Rules are placed against resolved IPs. Therefore **destinations that share an IP",
    "# with an allowed destination can be reached even if they are not listed here.** Things",
    "# behind the same CDN or hosting fall into this. Actually measured examples:",
    "#",
    "#   objects.githubusercontent.com   listed       reachable",
    "#   raw.githubusercontent.com       not listed   **reachable** (same IP)",
    "#   example.com                     not listed   blocked (different IP)",
    "#",
    "# **Do not treat this as a guarantee that data does not leave.** It is a mechanism that",
    "# reduces where traffic can go, not one that closes it off. **What actually protects is not",
    "# keeping credentials locally, and stopping at fixed conditions.**",
    "#",
    "# When adding one, write why it is needed alongside. If you cannot, it is likely not needed.",
    "#",
    "# **Wildcards cannot be written.** For the same reason. Each subdomain needs its own line.",
    "#",
    "# **This list is built from the configuration (autodrive.json).** Destinations for ports not in use",
    "# are not included. If you change the configuration, run `autodrive-dev-kit update` again.",
    "",
  ];

  const all = destinationsFor(config);
  const width = Math.max(...all.map((d) => d.host.length));

  let started = false;
  for (const d of all) {
    // **アプリ自身のものは、見出しを立てて分ける。** 混ぜると、autodrive-dev-kit のために開いて
    // いる穴なのか、作っているもののために開いている穴なのかが読み取れない。
    if (d.ofApp === true && !started) {
      started = true;
      lines.push("", "# Below here are this project's own destinations.");
    }
    lines.push(`${d.host.padEnd(width)}  # ${d.why}`);
  }

  // **ここへ直接書けと言わないこと。** 言っていた。そして `update` で消していた。
  // 書けと言った場所が、書いたものを消していた（AUT-115）。
  lines.push(
    "",
    "# When adding the deployment target or destinations this app calls, **do not edit this file directly.**",
    "# It is built from the configuration and rewritten on every `update`.",
    "#",
    "# Add them to app.destinations in autodrive.json, and run `autodrive-dev-kit update`.",
    "#   { \"host\": \"example.workers.dev\", \"why\": \"connectivity check of the deployment target\" }",
    "#",
    "# **Each destination needs its own line.** It takes effort, but that is where the judgment happens.",
  );
  return `${lines.join("\n")}\n`;
}
