/**
 * Tracker ポートの Linear アダプタ。
 *
 * **実装名を知るのはこの層だけとする（定義§16）。** 呼び出し側は
 * 「作業単位を起票する」としか言わない。差し替えるときはこのファイルを
 * 置き換える。
 */


const ENDPOINT = "https://api.linear.app/graphql";

/** 語彙の状態と、実装側の状態種別の対応。 */
const STATE_TYPE = {
  backlog: "backlog",
  todo: "unstarted",
  started: "started",
  done: "completed",
  canceled: "canceled",
};


/**
 * 対象リポジトリの持たせ方。
 *
 * **実装側にリポジトリの欄は無い。** ラベルで持たせる。接頭辞を付けるのは、
 * 人が付けたラベルと混ざらないようにするためと、**外して読めるようにするため**である。
 *
 * 題名の先頭に付ける案は採らなかった。付け忘れても誰も気づかず、後から直すと
 * 題名が二重になる。ラベルなら着手のときに機械的に付けられ、絞り込みにも使える。
 */
const REPO_MARK = "repo:";

/** ラベルの並びから、対象リポジトリを読む。無ければ null。 */
export function repoFrom(names) {
  const found = names.find((n) => n.startsWith(REPO_MARK));
  return found === undefined ? null : found.slice(REPO_MARK.length);
}

/** @returns {import("../ports/tracker.js").WorkItemView} */
function toView(raw) {
  // **`Object.entries` の鍵は `string` に広がる。** ポートが約束するのは語彙の
  // ほうなので、ここで寄せる（型検査を入れて判明。AUT-226）。
  const entry = /** @type {Array<[import("../ports/tracker.js").WorkItemState, string]>} */ (
    Object.entries(STATE_TYPE)
  ).find(([, type]) => type === raw.state.type);
  return {
    id: raw.identifier,
    title: raw.title,
    url: raw.url,
    body: raw.description ?? "",
    state: (entry?.[0] ?? "backlog") ,
    repo: repoFrom((raw.labels?.nodes ?? []).map((l) => l.name)),
  };
}

const ISSUE_FIELDS = "id identifier title url description state { type } labels { nodes { id name } }";

export class LinearTracker {
           #token;
           #teamKey;
  #teamId = null;

  constructor(token , teamKey) {
    this.#token = token;
    this.#teamKey = teamKey;
  }

  async #call(query , variables = {}) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: this.#token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await res.json());
    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new Error(`Tracker への要求が失敗した: ${payload.errors.map((e) => e.message).join(" / ")}`);
    }
    if (!res.ok) throw new Error(`Tracker への要求が失敗した: HTTP ${res.status}`);
    return payload.data;
  }

  /** チームの解決。1つしか無い場合は指定を省ける。 */
  async #team() {
    if (this.#teamId !== null) return this.#teamId;
    const data = await this.#call("{ teams { nodes { id key } } }");
    const teams = data.teams.nodes;
    const found =
      this.#teamKey === undefined
        ? teams.length === 1
          ? teams[0]
          : undefined
        : teams.find((t) => t.key === this.#teamKey);
    if (found === undefined) {
      const keys = teams.map((t) => t.key).join(", ");
      throw new Error(
        this.#teamKey === undefined
          ? `対象を1つに定められない。AUTODRIVE_TRACKER_TEAM で指定すること（候補: ${keys}）`
          : `指定された対象が見つからない: ${this.#teamKey}（候補: ${keys}）`,
      );
    }
    this.#teamId = found.id;
    return found.id;
  }

  /**
   * ポートの状態を、実装側の状態へ解決する。
   *
   * **同じ型の状態が複数あることを前提にする。** 型は種別であって、状態そのものでは
   * ない。実装側は同じ型の状態をいくつでも置ける。
   *
   * **並び順の先頭を採る。** 実装側が持つ並びは、作業が進む向きに並んでいる。同じ型の
   * 中で最も手前にあるものが、その型に入るときの状態である。
   *
   * 応答の順に頼ってはいけない。**順序は保証されない。** 実際に、連携を有効にしたことで
   * `started` 型が2つ（In Progress / In Review）になった直後、着手が In Review を
   * 引き当てた（AUT-165）。**それまでは1つしか無かったため、誤りが表に出なかった。**
   */
  async #stateId(to) {
    const teamId = await this.#team();
    const data = await this.#call(
      "query($id:String!){ team(id:$id){ states { nodes { id type position } } } }",
      { id: teamId },
    );
    const found = data.team.states.nodes
      .filter((s) => s.type === STATE_TYPE[to])
      .sort((a, b) => a.position - b.position)[0];
    if (found === undefined) throw new Error(`対応する状態が実装側に無い: ${to}`);
    return found.id;
  }

  async get(id) {
    if (id !== undefined) {
      const data = await this.#call(`query($id:String!){ issue(id:$id){ ${ISSUE_FIELDS} } }`, { id });
      return data.issue === null ? null : toView(data.issue);
    }
    // 次に着手する対象。未着手のうち最も古いものとする。
    const teamId = await this.#team();
    const data = await this.#call(
      `query($id:String!){ team(id:$id){ issues(first:50, orderBy:createdAt){ nodes { ${ISSUE_FIELDS} } } } }`,
      { id: teamId },
    );
    const nodes = (data.team.issues.nodes).map(toView);
    return nodes.find((n) => n.state === "todo" || n.state === "backlog") ?? null;
  }

  async list(limit = 250) {
    const teamId = await this.#team();
    const data = await this.#call(
      `query($id:String!,$n:Int!){ team(id:$id){ issues(first:$n){ nodes { ${ISSUE_FIELDS} } } } }`,
      { id: teamId, n: limit },
    );
    return (data.team.issues.nodes).map(toView);
  }

  async create(input) {
    const teamId = await this.#team();
    const data = await this.#call(
      `mutation($t:String!,$d:String!,$team:String!){
         issueCreate(input:{title:$t, description:$d, teamId:$team}){ issue { ${ISSUE_FIELDS} } } }`,
      { t: input.title, d: input.body, team: teamId },
    );
    return toView(data.issueCreate.issue);
  }

  /**
   * ラベルのIDを引く。無ければ作る。
   *
   * **作るところまでやる。** 使う側に「先にラベルを用意しておくこと」を課すと、用意
   * されていない対象で着手が落ちる。落ちる先は、規約を知らない人の手元である。
   */
  async #markId(repo) {
    const name = `${REPO_MARK}${repo}`;
    const teamId = await this.#team();
    const data = await this.#call(
      "query($id:String!){ team(id:$id){ labels(first:250){ nodes { id name } } } }",
      { id: teamId },
    );
    const found = data.team.labels.nodes.find((l) => l.name === name);
    if (found !== undefined) return found.id;
    const made = await this.#call(
      "mutation($n:String!,$t:String!){ issueLabelCreate(input:{name:$n, teamId:$t}){ issueLabel { id } } }",
      { n: name, t: teamId },
    );
    return made.issueLabelCreate.issueLabel.id;
  }

  /**
   * 対象リポジトリを記す。
   *
   * **付け替えられるようにする。** 古いラベルを残したまま新しいラベルを足すと、どちらが
   * 本当か読む側から分からない。**間違ったラベルは、ラベルが無いより悪い。**
   */
  async mark(id , repo) {
    const raw = (
      await this.#call(`query($id:String!){ issue(id:$id){ ${ISSUE_FIELDS} } }`, { id })
    ).issue;
    const stale = (raw.labels?.nodes ?? []).filter(
      (l) => l.name.startsWith(REPO_MARK) && l.name !== `${REPO_MARK}${repo}`,
    );
    for (const l of stale) {
      await this.#call(
        "mutation($i:String!,$l:String!){ issueRemoveLabel(id:$i, labelId:$l){ success } }",
        { i: raw.id, l: l.id },
      );
    }
    if (repoFrom((raw.labels?.nodes ?? []).map((l) => l.name)) === repo) return toView(raw);
    const data = await this.#call(
      `mutation($i:String!,$l:String!){ issueAddLabel(id:$i, labelId:$l){ issue { ${ISSUE_FIELDS} } } }`,
      { i: raw.id, l: await this.#markId(repo) },
    );
    return toView(data.issueAddLabel.issue);
  }

  /**
   * 状態を進める。着手のときは、対象リポジトリも記す。
   *
   * **ラベルを先に付ける。** 後にすると、状態だけ進んでラベルの無い作業単位が残る。それは
   * いま散らかっているものと同じ形であり、**直したはずの状態に戻る。**
   */
  /**
   * @param {string} id
   * @param {import("../ports/tracker.js").WorkItemState} to
   * @param {string} [repo]
   */
  async advance(id , to, repo = undefined) {
    if (repo !== undefined && repo !== "") await this.mark(id, repo);
    const stateId = await this.#stateId(to);
    const data = await this.#call(
      `mutation($id:String!,$s:String!){
         issueUpdate(id:$id, input:{stateId:$s}){ issue { ${ISSUE_FIELDS} } } }`,
      { id, s: stateId },
    );
    return toView(data.issueUpdate.issue);
  }

  async note(id , text) {
    await this.#call(
      "mutation($id:String!,$b:String!){ commentCreate(input:{issueId:$id, body:$b}){ success } }",
      { id, b: text },
    );
  }
}
