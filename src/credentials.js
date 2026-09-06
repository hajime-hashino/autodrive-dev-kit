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
 *   needs?: Array<{ permission: string, level: string, why: string, via: string }>,
 *   note?: string
 * }} Credential
 */

/**
 * ## 権限は推測しない。実装に聞く
 *
 * `via` は、その権限を要求している口である。**GitHub 自身が答えを返す。**
 *
 * ```sh
 * curl -sD - -o /dev/null -H "Authorization: Bearer $GH_TOKEN" \
 *   https://api.github.com/repos/<所有者>/<名前>/pulls | grep -i x-accepted-github
 * # x-accepted-github-permissions: pull_requests=read
 * ```
 *
 * **推測で並べて、実際に人を止めた**（AUT-110）。存在すると思った権限を並べ、
 * 要ると思った権限を並べた。判定も同じ思い込みから書いたため、思い込みを確かめる
 * 代わりに固定した。**同じ前提から書いた判定は、その前提を検査しない。**
 *
 * 権限を足す・変えるときは、上を叩いてから書くこと。
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
      //
      // **ただし、要らないものを並べない。** 並べると、探しても見つからない項目や、
      // 渡す必要のない強い権限を人に求めることになり、**別の停止を作る**（AUT-110）。
      needs: [
        {
          permission: "Contents",
          level: "Read and write",
          why: "push",
          via: "git push（HTTPS）",
        },
        {
          permission: "Pull requests",
          level: "Read and write",
          why: "提出の作成と、統合されたかの読取",
          via: "POST /repos/{repo}/pulls, GET /repos/{repo}/pulls",
        },
        {
          permission: "Actions",
          level: "Read",
          why: "CI が動いたか・通ったかの確認",
          via: "GET /repos/{repo}/actions/runs",
        },
        {
          permission: "Workflows",
          level: "Read and write",
          why: "CI 定義を置く・変える",
          via: "git push（.github/workflows/ を含む変更）",
        },
        {
          permission: "Secrets",
          level: "Read and write",
          why: "CI が使う資格情報の登録",
          via: "PUT /repos/{repo}/actions/secrets/{name}",
        },
      ],
      // **置き場所の作成は、あえて渡さない。**
      //
      // GitHub は `POST /user/repos` に `administration=write` を要求する。しかし
      // まだ無いリポジトリを「選んだリポジトリ」に含めることはできないため、渡すには
      // **すべてのリポジトリに対する管理権限**を渡すしかない。それは、持っている
      // 置き場所を丸ごと消せる鍵である。
      //
      // **1つ作るために、全部を消せる鍵を渡さない。** 定義§9が固定条件として挙げる
      // 「外部への不可逆な操作」に、常時手が届く状態を作らないためでもある。
      note:
        "置き場所（リポジトリ）そのものの作成は、この権限では行えない。" +
        "作成には全リポジトリへの管理権限が要るため、**あえて求めていない。** " +
        "置き場所は人が作り、このトークンをそこへ絞ること。",
    },
    {
      name: "AUTODRIVE_CI_TOKEN",
      why: "判定が Repo を読む。無いと「外側ループが起動したか」を判定できない",
      lost: "再発行する",
      // **なぜ GH_TOKEN で兼ねないかを書く。** 2つ並んでいる理由が書いていないと、
      // 「同じ GitHub なのになぜ2つ要るのか」が分からず、片方で兼ねたくなる。
      // 実際に、使い分けを問われている（AUT-139）。
      //
      // 兼ねると、**判定する側が判定対象を書き換えられる。** 定義§9の「AIがこれらを
      // 無効化できないこと」を見るのが判定器であり、その分離が消える。
      note:
        "**GH_TOKEN で兼ねないこと。** こちらは判定に使い、読取しか要らない。" +
        "書ける鍵を渡すと、**判定する側が判定対象を書き換えられる。** " +
        "CI へ登録するのはこちらだけであり、CI に書き込み用の鍵は置かない。",
      // **保護設定の読取に Administration は要らない。** GitHub が要求するのは
      // Metadata: Read であり、これは選ばなくても必ず付く（AUT-110 で実測）。
      needs: [
        {
          permission: "Pull requests",
          level: "Read",
          why: "統合されたかの読取",
          via: "GET /repos/{repo}/commits/{sha}/pulls",
        },
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

  // **アプリ自身のものを、最後に足す。** ポートの資格情報はどのプロジェクトでも
  // 同じだが、これはこのプロジェクト固有である。分けて並べると、どこまでが道具の
  // 都合で、どこからが作っているものの都合かが読み取れる。
  for (const c of config.app?.credentials ?? []) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push({ ...c, ofApp: true });
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

  let started = false;
  for (const c of credentialsFor(config)) {
    // **アプリ自身のものは、見出しを立てて分ける。** 混ぜると、道具のために要るのか
    // 作っているもののために要るのかが読み取れない。
    if (c.ofApp === true && !started) {
      started = true;
      lines.push(
        "",
        "# ここから下は、このプロジェクト自身のもの。",
        "# **足すときは autodrive.json の app.credentials に書き、`update` を打つこと。**",
        "# ここへ直接書いても、入れ替えのときに消える。",
      );
    }
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
    // **求めていない権限について、求めていない理由を書く。** 書かないと、足りないと
    // 思った人が自分で足す。足せば、渡す必要のない権限が渡る。
    if (c.note !== undefined) lines.push(`# ${c.note}`, "#");
    lines.push(`# 失ったとき: ${c.lost}`, `${c.name}=`);
  }
  return `${lines.join("\n")}\n`;
}
