import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECKS } from "../src/checks.ts";
import type { CheckInput } from "../src/checks.ts";
import { movedAreas, parseAreas } from "../src/boundaries.ts";
import type { Repo } from "../src/repos.ts";
import type { ApiResponse, RepoApi } from "../src/repoApi.ts";
import type { TrackerPort, WorkItemView } from "../src/ports/tracker.ts";
import { ACTIVE, SUBSTITUTED, UNSUBSTITUTED } from "../src/state.ts";
import type { TelemetryEvent } from "../src/telemetry.ts";

const outerLoop = CHECKS.find((c) => c.key === "outer_loop_running")!;

/** 領域を1つだけ持つ境界表。 */
function table(over: { detectable?: boolean; state?: string; extra?: string } = {}): string {
  const { detectable = false, state = "保留", extra = "" } = over;
  return `# 境界表
version: 1

areas:
  - id: review/appearance
    operation: 確かめる
    target: 動くプロダクトの見え方
    detectable: ${detectable}
    reversible: true
    state: ${state}
    basis: |
      根拠の本文。ここに state: 委譲済み と書いても属性ではない。
      detectable: true と書いても同じ。
${extra}`;
}

/**
 * git の応答を差し替えたリポジトリ。
 *
 * versions は「コミット → その時点の境界表」。親の版が無いコミットが初期設置。
 */
function repoWith(versions: [string, string][], history: string, slug: string | null = "owner/p"): Repo {
  const at = new Map(versions);
  const order = versions.map(([sha]) => sha);
  return {
    name: "p",
    path: "/tmp/p",
    remoteSlug: () => slug,
    boundariesFile: () => "/tmp/p/boundaries.yaml",
    boundaryHistoryFile: () => "/tmp/p/docs/boundary-changes.md",
    telemetryFiles: () => [],
    read: () => history,
    git: (...args: string[]) => {
      if (args[0] === "log") return [...order].reverse().join("\n");
      if (args[0] === "show") {
        const spec = args[1];
        const parent = spec.includes("^");
        const sha = spec.split(/[\^:]/)[0];
        const index = order.indexOf(sha);
        if (index < 0) return null;
        if (!parent) return at.get(sha) ?? null;
        return index === 0 ? null : (at.get(order[index - 1]) ?? null);
      }
      return null;
    },
  } as unknown as Repo;
}

function api(responder: (sha: string) => ApiResponse): RepoApi {
  return {
    available: true,
    rulesets: async () => ({ status: 200, body: [] }),
    submissionsFor: async (_slug, sha) => responder(sha),
    repository: async () => ({ status: 200, body: { default_branch: "main" } }),
  };
}

const merged = (): ApiResponse => ({ status: 200, body: [{ merged_at: "2026-08-23T00:00:00Z" }] });
const notMerged = (): ApiResponse => ({ status: 200, body: [{ merged_at: null }] });
const forbidden = (): ApiResponse => ({ status: 403, body: { message: "Resource not accessible" } });

/** 代替を SUBSTITUTED として読めるようにするための代替の記録。 */
const substitution = {
  source: "p/telemetry/AUT-1.jsonl",
  work_item_id: "AUT-1",
  model: "claude-opus-5",
  kit_version: "bootstrap",
  emitter: "adapter",
  type: "substitution",
  invariant: "outer_loop_running",
  detail: "まだ一周していない",
} as unknown as TelemetryEvent;

const tracker: TrackerPort = {
  async get() { return null; },
  async list() { return [] as WorkItemView[]; },
  async create() { return {} as WorkItemView; },
  async advance() { return {} as WorkItemView; },
  async note() {},
};

function input(repo: Repo, responder: (sha: string) => ApiResponse): CheckInput {
  return {
    repos: [repo],
    events: [substitution],
    broken: [],
    api: api(responder),
    tracker,
    scope: "cross",
  };
}

const HISTORY = `# 境界変更履歴

## 2026-08-23 見え方を気づける側へ動かした

- 設定変更: commit bbbbbbb
- 根拠: 検出漏れ3件
`;

// ----------------------------------------------------------------- 境界表の読取

test("根拠の本文に現れた属性名を、属性として読まない", () => {
  const areas = parseAreas(table());
  assert.equal(areas.length, 1);
  assert.equal(areas[0].id, "review/appearance");
  assert.equal(areas[0].detectable, false);
  assert.equal(areas[0].state, "保留");
});

test("セルも状態も変わらなければ、動いたとは数えない", () => {
  const before = parseAreas(table());
  const after = parseAreas(table());
  assert.deepEqual(movedAreas(before, after), []);
});

test("気づけるかが変われば動いたと数える", () => {
  const moved = movedAreas(parseAreas(table()), parseAreas(table({ detectable: true })));
  assert.deepEqual(moved, ["review/appearance"]);
});

test("状態が変われば動いたと数える", () => {
  const moved = movedAreas(parseAreas(table()), parseAreas(table({ state: "委譲済み" })));
  assert.deepEqual(moved, ["review/appearance"]);
});

test("領域の増減も動きとして数える", () => {
  const extra = `
  - id: add/dependency
    operation: 追加する
    target: 依存
    detectable: false
    reversible: true
    state: 観察中
`;
  const moved = movedAreas(parseAreas(table()), parseAreas(table({ extra })));
  assert.deepEqual(moved, ["add/dependency"]);
});

// ----------------------------------------------------------------- 起動の判定

test("初期設置だけでは、外側ループは一周していない", async () => {
  const repo = repoWith([["aaaaaaa", table()]], HISTORY);
  const r = await outerLoop.run(input(repo, merged));
  assert.equal(r.state, SUBSTITUTED);
});

test("セルが動き、根拠と統合済みの提出が揃えば有効", async () => {
  const repo = repoWith(
    [["aaaaaaa", table()], ["bbbbbbb", table({ detectable: true })]],
    HISTORY,
  );
  const r = await outerLoop.run(input(repo, merged));
  assert.equal(r.state, ACTIVE);
});

test("コメントだけを直した変更は、動いたと数えない", async () => {
  const repo = repoWith(
    [["aaaaaaa", table()], ["bbbbbbb", `# 書き足したコメント\n${table()}`]],
    HISTORY,
  );
  const r = await outerLoop.run(input(repo, merged));
  assert.equal(r.state, SUBSTITUTED);
});

test("履歴から参照されていなければ有効しない", async () => {
  const repo = repoWith(
    [["aaaaaaa", table()], ["bbbbbbb", table({ detectable: true })]],
    "# 境界変更履歴\n\n## 別の話\n\n- 根拠: なし\n",
  );
  const r = await outerLoop.run(input(repo, merged));
  assert.equal(r.state, SUBSTITUTED);
});

test("根拠が書かれていなければ有効しない", async () => {
  const repo = repoWith(
    [["aaaaaaa", table()], ["bbbbbbb", table({ detectable: true })]],
    "# 境界変更履歴\n\n## 動かした\n\n- 設定変更: commit bbbbbbb\n",
  );
  const r = await outerLoop.run(input(repo, merged));
  assert.equal(r.state, SUBSTITUTED);
});

test("まだ統合されていなければ有効しない", async () => {
  const repo = repoWith(
    [["aaaaaaa", table()], ["bbbbbbb", table({ detectable: true })]],
    HISTORY,
  );
  const r = await outerLoop.run(input(repo, notMerged));
  assert.equal(r.state, SUBSTITUTED);
});

// **読めないことを、通ったことにしない。** 承認を確かめられないまま有効を名乗ると
// 判定そのものが意味を失う。そして**代替でもない。** 判定できていない状態であり、
// 定義§9はそれ自体を失敗として扱う。
test("統合を読めなければ失敗する。代替ではない", async () => {
  const repo = repoWith(
    [["aaaaaaa", table()], ["bbbbbbb", table({ detectable: true })]],
    HISTORY,
  );
  const r = await outerLoop.run(input(repo, forbidden));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(
    r.observations.some((o) => o.includes("403") && o.includes("承認")),
    `読めない理由が出ていない: ${JSON.stringify(r.observations)}`,
  );
});

test("origin が無ければ承認を確かめられず、失敗する", async () => {
  const repo = repoWith(
    [["aaaaaaa", table()], ["bbbbbbb", table({ detectable: true })]],
    HISTORY,
    null,
  );
  const r = await outerLoop.run(input(repo, merged));
  assert.equal(r.state, UNSUBSTITUTED);
});

// 判定できていないのは、結論が出せない場合に限る。
test("1件でも承認が揃っていれば、別の1件が読めなくても有効になる", async () => {
  const history = `${HISTORY}
## 2026-08-24 もう1つ動かした

- 設定変更: commit ccccccc
- 根拠: 実績2件
`;
  const repo = repoWith(
    [
      ["aaaaaaa", table()],
      ["bbbbbbb", table({ detectable: true })],
      ["ccccccc", table({ detectable: true, state: "委譲済み" })],
    ],
    history,
  );
  const r = await outerLoop.run(input(repo, (sha) => (sha === "ccccccc" ? forbidden() : merged())));
  assert.equal(r.state, ACTIVE);
  assert.ok(
    r.observations.some((o) => o.includes("403")),
    `読めなかった穴が残っていない: ${JSON.stringify(r.observations)}`,
  );
});
