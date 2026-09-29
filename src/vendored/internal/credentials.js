/**
 * 要る資格情報。
 *
 * **構成から組み立てる。** 許可する宛先（`sandbox.js`）と同じ考え方である。使わない
 * ポートの資格情報を求めると、要らないものを人に発行させることになる。逆に、使う
 * ポートのものが抜けていると、**動かない理由を人が自分で突き止めることになる。**
 *
 * 実際に `GH_TOKEN` が抜けていた（AUT-98）。サンドボックスの支度が使うのに、
 * 求めていなかった。**このワークディレクトリでは起きない。** 既にある `.env` に入っているため。
 */

/**
 * @typedef {{
 *   name: string,
 *   why: string,
 *   lost: string,
 *   needs?: Array<{ permission: string, level: string, why: string, via: string }>,
 *   note?: string,
 *   ofApp?: boolean
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
 * **git の作者情報は、環境を作り直すたびに要る。** ホストの設定は引き継がれない環境が
 * あり、無いと commit そのものが通らない。
 */
const ALWAYS = [
  {
    name: "GIT_USER_NAME",
    why: "Commit author information. Some environments do not carry over the host's git settings",
    lost: "Just decide it again",
  },
  {
    name: "GIT_USER_EMAIL",
    why: "Same as above",
    lost: "Just decide it again",
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
      why: "Submissions and push. **Without it, push fails** (the sandbox setup uses it for the git credential helper)",
      lost: "Reissue it. The old value stops working",
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
          why: "Creating submissions, and reading whether they were integrated",
          via: "POST /repos/{repo}/pulls, GET /repos/{repo}/pulls",
        },
        {
          permission: "Actions",
          level: "Read",
          why: "Checking whether CI ran and passed",
          via: "GET /repos/{repo}/actions/runs",
        },
        {
          permission: "Workflows",
          level: "Read and write",
          why: "Placing and changing CI definitions",
          via: "git push (changes that include .github/workflows/)",
        },
        {
          permission: "Secrets",
          level: "Read and write",
          why: "Registering the credentials CI uses",
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
        "Creating the place (repository) itself cannot be done with these permissions. " +
        "Creating it needs admin permission over all repositories, so **it is deliberately not requested.** " +
        "A human creates the place, and this token is narrowed to it.",
    },
    {
      name: "AUTODRIVE_CI_TOKEN",
      why: "The checks read the Repo. Without it, \"has the outer loop started\" cannot be judged",
      lost: "Reissue it",
      // **なぜ GH_TOKEN で兼ねないかを書く。** 2つ並んでいる理由が書いていないと、
      // 「同じ GitHub なのになぜ2つ要るのか」が分からず、片方で兼ねたくなる。
      // 実際に、使い分けを問われている（AUT-139）。
      //
      // 兼ねると、**判定する側が判定対象を書き換えられる。** 定義§9の「AIがこれらを
      // 無効化できないこと」を見るのが`invariants` であり、その分離が消える。
      note:
        "**Do not share GH_TOKEN for this.** This one is used for the checks and needs only read access. " +
        "Hand over a key that can write, and **the side that checks can rewrite what it checks.** " +
        "Only this one is registered in CI; no key for writing is placed in CI.",
      // **保護設定の読取に Administration は要らない。** GitHub が要求するのは
      // Metadata: Read であり、これは選ばなくても必ず付く（AUT-110 で実測）。
      needs: [
        {
          permission: "Pull requests",
          level: "Read",
          why: "Reading whether it was integrated",
          via: "GET /repos/{repo}/commits/{sha}/pulls",
        },
      ],
    },
  ],
  // **トークン消費の送り先。** OTLP で話すため、受け側の名前はここに出さない。
  // 宛先と認証は値で渡る（定義§16「実装名を知るのはアダプタだけ」）。
  //
  // **§6のイベントは、これが無くても記録される。** 無くて落ちるのはトークン消費
  // だけであり、それは任意の記録対象である（定義§6 v0.16）。
  "jsonl+otlp": [
    {
      name: "AUTODRIVE_OTLP_ENDPOINT",
      why: "Where token consumption is sent. **Not a secret** (it names a destination), but handled together with authentication",
      lost: "It can be checked on the receiving side's settings screen",
      note:
        "**Token consumption is an optional recording target** (definition §6). A configuration without it also works, " +
        "and in that case token consumption is not recorded. **The other five in §6 are not affected.**",
    },
    {
      name: "AUTODRIVE_OTLP_HEADERS",
      why: "Authentication for the destination. Written as `key=value,key=value` (following the OpenTelemetry convention)",
      lost: "Reissue the key on the receiving side, and rebuild `Authorization=Basic <base64(public key:secret key)>`",
      // **実際にここで 401 になった**（AUT-174）。値が切れていることは見えず、
      // 認証だけが落ちるため、キーが違うのかと疑うことになる。
      note:
        "**Quote it in `.env`.** The value contains a space (between `Basic` and the base64), " +
        "so unquoted, it is cut off at `Authorization=Basic` when the shell reads it. " +
        "**Cut off, it passes silently and only authentication fails with 401.**\n" +
        '    AUTODRIVE_OTLP_HEADERS="Authorization=Basic xxx,x-langfuse-ingestion-version=4"\n' +
        "**The value containing `=` is correct.** base64 ends with `=` (it is split only at the first `=`).",
    },
  ],
  linear: [
    {
      name: "LINEAR_API_KEY",
      why: "Getting, filing, and updating the status of work items",
      lost: "Reissue it",
    },
  ],
  // **同じ鍵に権限を足す。別の鍵を並べない。**
  //
  // 以前は `AUTODRIVE_TRACKER_TOKEN` を必須として並べていた。**同じ GitHub に
  // 対する書ける鍵が2つ並ぶ**ことになり、実際に人が2つ用意する羽目になった
  // （AUT-235）。どちらもエージェントが自分の作業のために持つものであり、
  // **分けても守れるものが増えない。**
  //
  // `AUTODRIVE_CI_TOKEN` を分けている理由（判定する側が判定対象を書き換えられる）
  // は、ここには当てはまらない。
  //
  // 名前が同じものは `needs` が合流する（`credentialsFor`）。Repo に GitHub を
  // 使っていない構成でも、この1件だけで成立する。
  "github-issues": [
    {
      name: "GH_TOKEN",
      why: "Getting, filing, and updating the status of work items",
      lost: "Reissue it. The old value stops working",
      note:
        "**To keep a separate one, set `AUTODRIVE_TRACKER_TOKEN`.** " +
        "If set, it is used instead. Use it when you want to narrow down just the work item operations.",
      needs: [
        {
          permission: "Issues",
          level: "Read and write",
          why: "Getting, filing, and updating the status of work items",
          via: "GET/POST/PATCH /repos/{repo}/issues",
        },
      ],
    },
  ],
  "cloudflare-workers": [
    {
      name: "CLOUDFLARE_API_TOKEN",
      why: "Deployment, and checking the state of the deployment target",
      lost: "Reissue it. The old value stops working",
    },
    {
      name: "CLOUDFLARE_ACCOUNT_ID",
      why: "Specifies the deployment target. **Not a secret** (it names something; it is not a credential), but handled as a pair",
      lost: "It can be checked on the dashboard",
    },
  ],
};

/**
 * 構成から、要る資格情報を組み立てる。
 *
 * **同じ名前は合流させる。落とさない。**
 *
 * 2つのポートが同じ鍵を使うことがある（Repo と Tracker の両方が GitHub の場合）。
 * 先に来たほうだけを採ると、**後から来たほうが要求する権限が消える。** 消えても
 * 静かに通り、その権限を使う操作だけが落ちる。**落ちる先は、規約を知らない人の
 * 手元である。**
 *
 * @param {import("./config.js").Config} config
 * @returns {Credential[]}
 */
export function credentialsFor(config) {
  const out = [...ALWAYS];
  /** @type {Map<string, Credential>} */
  const byName = new Map(out.map((c) => [c.name, c]));

  for (const port of Object.keys(config.ports)) {
    // 使わないポート（`none`）は表に無いため、何も足さない。
    for (const c of FOR_IMPLEMENTATION[config.ports[port]] ?? []) {
      const already = byName.get(c.name);
      if (already === undefined) {
        const fresh = { ...c };
        byName.set(c.name, fresh);
        out.push(fresh);
        continue;
      }
      // **権限を合流させる。** 同じ権限は二重に並べない。
      const known = new Set((already.needs ?? []).map((n) => `${n.permission}/${n.level}`));
      const added = (c.needs ?? []).filter((n) => !known.has(`${n.permission}/${n.level}`));
      if (added.length > 0) already.needs = [...(already.needs ?? []), ...added];
      // **用途も合流させる。** 片方しか書かないと、もう片方で使っていることが消える。
      if (!already.why.includes(c.why)) already.why = `${already.why}. ${c.why}`;
      // **注記は足す。** 分けたい人への案内が消える。
      if (c.note !== undefined && !(already.note ?? "").includes(c.note)) {
        already.note = already.note === undefined ? c.note : `${already.note}\n${c.note}`;
      }
    }
  }

  // **アプリ自身のものを、最後に足す。** ポートの資格情報はどのプロジェクトでも
  // 同じだが、これはこのプロジェクト固有である。分けて並べると、どこまでが autodrive-dev-kit の
  // 都合で、どこからが作っているものの都合かが読み取れる。
  for (const c of config.app?.credentials ?? []) {
    if (byName.has(c.name)) continue;
    byName.set(c.name, c);
    out.push({ ...c, ofApp: true });
  }
  return out;
}

/**
 * テンプレートを書き出す。
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
    "# Credentials. **This file is a template; do not write values in it.**",
    "# Copy it to create .env, and write them there (.env is not tracked).",
    "#",
    "# **This list is built from the configuration (autodrive.json).** Ports not in use are",
    "# not included. If you change the configuration, run `autodrive-dev-kit update` again.",
  ];

  let started = false;
  for (const c of credentialsFor(config)) {
    // **アプリ自身のものは、見出しを立てて分ける。** 混ぜると、autodrive-dev-kit のために要るのか
    // 作っているもののために要るのかが読み取れない。
    if (c.ofApp === true && !started) {
      started = true;
      lines.push(
        "",
        "# Below here belongs to this project itself.",
        "# **To add one, write it in app.credentials in autodrive.json and run `update`.**",
        "# Writing here directly gets erased on replacement.",
      );
    }
    lines.push("", `# ${c.why}`);
    // **要る権限を先に全部並べる。** 足りないまま作ると、作業が進んでから止まり、
    // 足すたびにまた止まる。**一度で済む形にする。**
    if (c.needs !== undefined) {
      lines.push("#", "# Permissions needed (grant them all at once when creating it):");
      const width = Math.max(...c.needs.map((n) => n.permission.length));
      for (const n of c.needs) {
        lines.push(`#   ${n.permission.padEnd(width)}  ${n.level.padEnd(14)} ${n.why}`);
      }
      lines.push("#");
    }
    // **求めていない権限について、求めていない理由を書く。** 書かないと、足りないと
    // 思った人が自分で足す。足せば、渡す必要のない権限が渡る。
    //
    // **複数行でも、すべての行をコメントにする。** 注記は合流すると改行を含む（GH_TOKEN を
    // Repo と Tracker の両方が求める構成）。先頭の行にしか `#` を付けないと、残りが
    // 値の行として読まれ、写して作った `.env` が壊れる（#115）。
    if (c.note !== undefined) lines.push(...c.note.split("\n").map((l) => `# ${l.trim()}`), "#");
    lines.push(`# If lost: ${c.lost}`, `${c.name}=`);
  }
  return `${lines.join("\n")}\n`;
}
