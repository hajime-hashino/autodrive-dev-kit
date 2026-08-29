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
 */

import type { Config, PortName } from "./config.ts";

export interface Destination {
  host: string;
  why: string;
}

/** どの構成でも要るもの。**AIが動かなければ何も始まらない。** */
const ALWAYS: Destination[] = [
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
const FOR_IMPLEMENTATION: Record<string, Destination[]> = {
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
export function destinationsFor(config: Config): Destination[] {
  const out = [...ALWAYS];
  const seen = new Set(out.map((d) => d.host));

  for (const port of Object.keys(config.ports) as PortName[]) {
    // **使わないポート（`none`）は表に無いため、何も足さない。**
    // 実装名で引くので、実装ごとの宛先だけが入る。
    for (const d of FOR_IMPLEMENTATION[config.ports[port]] ?? []) {
      if (seen.has(d.host)) continue;
      seen.add(d.host);
      out.push(d);
    }
  }
  return out;
}

/**
 * 許可一覧を書き出す。
 *
 * **なぜ要るのかを併記する。** 書けないなら要らない可能性が高い。後から読む人が
 * 消してよいかを判断できる。
 */
export function allowedDomains(config: Config): string {
  const lines = [
    "# 外向き通信を許可する宛先。",
    "#",
    "# **ここに無い宛先へは出られない。** 追加するときは、なぜ要るのかを併記すること。",
    "# 書けないなら要らない可能性が高い。",
    "#",
    "# **ワイルドカードは書けない。** 規則は名前解決した IP に対して置かれるため、",
    "# サブドメインごとに1行が要る。",
    "#",
    "# **この一覧は構成（autodrive.json）から作られている。** 使わないポートの宛先は",
    "# 入っていない。構成を変えたら `autodrive-dev-kit update` を打ち直すこと。",
    "",
  ];

  const width = Math.max(...destinationsFor(config).map((d) => d.host.length));
  for (const d of destinationsFor(config)) {
    lines.push(`${d.host.padEnd(width)}  # ${d.why}`);
  }

  lines.push(
    "",
    "# 配布された先の疎通確認。**配布先が決まったら、ここへ足すこと。**",
    "# 宛先ごとに1行が要る。手が要るが、**そこが判断の機会になる。**",
  );
  return `${lines.join("\n")}\n`;
}
