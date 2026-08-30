/**
 * 要る資格情報。
 *
 * **構成から組み立てる。** 許可する宛先（`sandbox.js`）と同じ考え方である。使わない
 * ポートの資格情報を求めると、要らないものを人に発行させることになる。逆に、使う
 * ポートのものが抜けていると、**動かない理由を人が自分で突き止めることになる。**
 *
 * 実際に `GH_TOKEN` が抜けていた（AUT-98）。サンドボックスの支度が使うのに、
 * 求めていなかった。**この作業場では起きない。** 既にある `.env` に入っているため。
 */

/**
 * @typedef {{
 *   name: string,
 *   why: string,
 *   lost: string,
 *   needs?: Array<{ permission: string, level: string, why: string }>
 * }} Credential
 */

/**
 * どの構成でも要るもの。
 *
 * **git の身元は、環境を作り直すたびに要る。** ホストの設定は引き継がれない環境が
 * あり、無いと commit そのものが通らない。
 */
const ALWAYS = [
  {
    name: "GIT_USER_NAME",
    why: "コミットの身元。ホストの git の設定は引き継がれない環境がある",
    lost: "決め直すだけでよい",
  },
  {
    name: "GIT_USER_EMAIL",
    why: "同上",
    lost: "決め直すだけでよい",
  },
];

/**
 * ポートの実装ごとに要るもの。
 *
 * **実装名で引く。** ポート名で引くと、実装を差し替えたときに資格情報が付いてくる。
 */
const FOR_IMPLEMENTATION = {
  github: [
    {
      name: "GH_TOKEN",
      why: "提出と push。**無いと push が通らない**（作業場の支度が git の資格情報ヘルパに使う）",
      lost: "再発行する。古い値は使えなくなる",
      // **要る権限を先に全部言う。** 足りないまま作ると、作業が進んでから止まる。
      // 足すたびにまた止まる。**同じ停止が2つのプロジェクトで起きた**（AUT-108）。
      needs: [
        { permission: "Contents", level: "Read and write", why: "push" },
        {
          permission: "Pull requests",
          level: "Read and write",
          why: "提出の作成と、統合されたかの読取",
        },
        { permission: "Actions", level: "Read", why: "CI が動いたか・通ったかの確認" },
        { permission: "Checks", level: "Read", why: "判定結果の読取" },
        {
          permission: "Administration",
          level: "Read and write",
          why: "既定ブランチの保護設定の読取。**書き込みは置き場所の作成に要る**",
        },
        { permission: "Workflows", level: "Read and write", why: "CI 定義を置く・変える" },
        { permission: "Secrets", level: "Read and write", why: "CI が使う資格情報の登録" },
      ],
    },
    {
      name: "AUTODRIVE_CI_TOKEN",
      why: "判定が Repo を読む。無いと「外側ループが起動したか」を判定できない",
      lost: "再発行する",
      needs: [
        { permission: "Pull requests", level: "Read", why: "統合されたかの読取" },
        { permission: "Administration", level: "Read", why: "保護設定の読取" },
      ],
    },
  ],
  linear: [
    {
      name: "LINEAR_API_KEY",
      why: "作業単位の取得・起票・状態の更新",
      lost: "再発行する",
    },
  ],
  "cloudflare-workers": [
    {
      name: "CLOUDFLARE_API_TOKEN",
      why: "配布と、配布先の状態の確認",
      lost: "再発行する。古い値は使えなくなる",
    },
    {
      name: "CLOUDFLARE_ACCOUNT_ID",
      why: "配布先の指定。**秘密ではない**（資格情報ではなく名指し）が、組で扱う",
      lost: "ダッシュボードで確認できる",
    },
  ],
};

/**
 * 構成から、要る資格情報を組み立てる。**重複は落とす。**
 *
 * @param {import("./config.js").Config} config
 * @returns {Credential[]}
 */
export function credentialsFor(config) {
  const out = [...ALWAYS];
  const seen = new Set(out.map((c) => c.name));

  for (const port of Object.keys(config.ports)) {
    // 使わないポート（`none`）は表に無いため、何も足さない。
    for (const c of FOR_IMPLEMENTATION[config.ports[port]] ?? []) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
  }
  return out;
}

/**
 * 雛形を書き出す。
 *
 * **何に使うかと、失ったらどうなるかを併記する。** 名前だけ並べても、人は何を
 * 取りに行けばよいか分からない。失ったときの影響が書いていないと、扱いの重さも
 * 判断できない。
 *
 * @param {import("./config.js").Config} config
 * @returns {string}
 */
export function envExample(config) {
  const lines = [
    "# 資格情報。**このファイルは雛形であり、値を書かない。**",
    "# 写して .env を作り、そちらに書くこと（.env は追跡しない）。",
    "#",
    "# **この一覧は構成（autodrive.json）から作られている。** 使わないポートのものは",
    "# 入っていない。構成を変えたら `autodrive-dev-kit update` を打ち直すこと。",
  ];

  for (const c of credentialsFor(config)) {
    lines.push("", `# ${c.why}`);
    // **要る権限を先に全部並べる。** 足りないまま作ると、作業が進んでから止まり、
    // 足すたびにまた止まる。**一度で済む形にする。**
    if (c.needs !== undefined) {
      lines.push("#", "# 要る権限（作るときに、まとめて付けること）:");
      const width = Math.max(...c.needs.map((n) => n.permission.length));
      for (const n of c.needs) {
        lines.push(`#   ${n.permission.padEnd(width)}  ${n.level.padEnd(14)} ${n.why}`);
      }
      lines.push("#");
    }
    lines.push(`# 失ったとき: ${c.lost}`, `${c.name}=`);
  }
  return `${lines.join("\n")}\n`;
}
