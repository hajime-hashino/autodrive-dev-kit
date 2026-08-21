/**
 * Tracker ポートの Linear アダプタ。
 *
 * **実装名を知るのはこの層だけとする（定義§16）。** 呼び出し側は
 * 「作業単位を起票する」としか言わない。差し替えるときはこのファイルを
 * 置き換える。
 */

import type {
  CreateInput,
  TrackerPort,
  WorkItemState,
  WorkItemView,
} from "../ports/tracker.ts";

const ENDPOINT = "https://api.linear.app/graphql";

/** 語彙の状態と、実装側の状態種別の対応。 */
const STATE_TYPE: Record<WorkItemState, string> = {
  backlog: "backlog",
  todo: "unstarted",
  started: "started",
  done: "completed",
  canceled: "canceled",
};

interface RawIssue {
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  state: { type: string };
}

function toView(raw: RawIssue): WorkItemView {
  const entry = Object.entries(STATE_TYPE).find(([, type]) => type === raw.state.type);
  return {
    id: raw.identifier,
    title: raw.title,
    url: raw.url,
    body: raw.description ?? "",
    state: (entry?.[0] ?? "backlog") as WorkItemState,
  };
}

const ISSUE_FIELDS = "identifier title url description state { type }";

export class LinearTracker implements TrackerPort {
  readonly #token: string;
  readonly #teamKey: string | undefined;
  #teamId: string | null = null;

  constructor(token: string, teamKey?: string) {
    this.#token = token;
    this.#teamKey = teamKey;
  }

  async #call(query: string, variables: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: this.#token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await res.json()) as { data?: unknown; errors?: { message: string }[] };
    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new Error(`Tracker への要求が失敗した: ${payload.errors.map((e) => e.message).join(" / ")}`);
    }
    if (!res.ok) throw new Error(`Tracker への要求が失敗した: HTTP ${res.status}`);
    return payload.data;
  }

  /** チームの解決。1つしか無い場合は指定を省ける。 */
  async #team(): Promise<string> {
    if (this.#teamId !== null) return this.#teamId;
    const data = await this.#call("{ teams { nodes { id key } } }");
    const teams = data.teams.nodes as { id: string; key: string }[];
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

  async #stateId(to: WorkItemState): Promise<string> {
    const teamId = await this.#team();
    const data = await this.#call(
      "query($id:String!){ team(id:$id){ states { nodes { id type } } } }",
      { id: teamId },
    );
    const states = data.team.states.nodes as { id: string; type: string }[];
    const found = states.find((s) => s.type === STATE_TYPE[to]);
    if (found === undefined) throw new Error(`対応する状態が実装側に無い: ${to}`);
    return found.id;
  }

  async get(id?: string): Promise<WorkItemView | null> {
    if (id !== undefined) {
      const data = await this.#call(`query($id:String!){ issue(id:$id){ ${ISSUE_FIELDS} } }`, { id });
      return data.issue === null ? null : toView(data.issue as RawIssue);
    }
    // 次に着手する対象。未着手のうち最も古いものとする。
    const teamId = await this.#team();
    const data = await this.#call(
      `query($id:String!){ team(id:$id){ issues(first:50, orderBy:createdAt){ nodes { ${ISSUE_FIELDS} } } } }`,
      { id: teamId },
    );
    const nodes = (data.team.issues.nodes as RawIssue[]).map(toView);
    return nodes.find((n) => n.state === "todo" || n.state === "backlog") ?? null;
  }

  async list(limit = 250): Promise<WorkItemView[]> {
    const teamId = await this.#team();
    const data = await this.#call(
      `query($id:String!,$n:Int!){ team(id:$id){ issues(first:$n){ nodes { ${ISSUE_FIELDS} } } } }`,
      { id: teamId, n: limit },
    );
    return (data.team.issues.nodes as RawIssue[]).map(toView);
  }

  async create(input: CreateInput): Promise<WorkItemView> {
    const teamId = await this.#team();
    const data = await this.#call(
      `mutation($t:String!,$d:String!,$team:String!){
         issueCreate(input:{title:$t, description:$d, teamId:$team}){ issue { ${ISSUE_FIELDS} } } }`,
      { t: input.title, d: input.body, team: teamId },
    );
    return toView(data.issueCreate.issue as RawIssue);
  }

  async advance(id: string, to: WorkItemState): Promise<WorkItemView> {
    const stateId = await this.#stateId(to);
    const data = await this.#call(
      `mutation($id:String!,$s:String!){
         issueUpdate(id:$id, input:{stateId:$s}){ issue { ${ISSUE_FIELDS} } } }`,
      { id, s: stateId },
    );
    return toView(data.issueUpdate.issue as RawIssue);
  }

  async note(id: string, text: string): Promise<void> {
    await this.#call(
      "mutation($id:String!,$b:String!){ commentCreate(input:{issueId:$id, body:$b}){ success } }",
      { id, b: text },
    );
  }
}
