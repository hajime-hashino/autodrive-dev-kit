import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS } from "../src/checks.ts";
import type { CheckInput } from "../src/checks.ts";
import type { Repo } from "../src/repos.ts";
import type { ApiResponse, RepoApi } from "../src/repoApi.ts";
import type { TrackerPort, WorkItemView } from "../src/ports/tracker.ts";
import { ACTIVE, NOT_IN_SCOPE, SUBSTITUTED, UNSUBSTITUTED } from "../src/state.ts";
import type { TelemetryEvent } from "../src/telemetry.ts";

function check(key: string) {
  const found = CHECKS.find((c) => c.key === key);
  assert.ok(found, `判定が登録されていない: ${key}`);
  return found;
}

/** 既定ブランチが提出だけで作られている履歴。根 + マージコミット。 */
const CLEAN_LOG = [
  "bbbbbbb\taaaaaaa ccccccc\tMerge pull request #1",
  "aaaaaaa\t\t初期化",
].join("\n");

function fakeRepo(
  name: string,
  slug: string | null = `owner/${name}`,
  log: string | null = CLEAN_LOG,
): Repo {
  return {
    name,
    path: `/tmp/${name}`,
    remoteSlug: () => slug,
    boundariesFile: () => null,
    boundaryHistoryFile: () => null,
    telemetryFiles: () => [],
    git: (...args: string[]) => {
      if (args[0] === "symbolic-ref") return "origin/main\n";
      if (args[0] === "log") return log;
      return null;
    },
    read: () => "",
  } as unknown as Repo;
}

/** 記録を自動で残す仕掛けが登録されているリポジトリ。発効の条件のひとつ。 */
function repoWithHook(name: string): Repo {
  const path = mkdtempSync(join(tmpdir(), "autodrive-repo-"));
  mkdirSync(join(path, ".claude"), { recursive: true });
  writeFileSync(
    join(path, ".claude", "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "k/hooks/record-tokens" }] }] } }),
    "utf8",
  );
  return { ...fakeRepo(name), path } as unknown as Repo;
}

function fakeApi(responder: (slug: string) => ApiResponse, available = true): RepoApi {
  return {
    available,
    rulesets: async (slug) => responder(slug),
    submissionsFor: async () => ({ status: 200, body: [] }),
  };
}

function event(over: Record<string, unknown> = {}): TelemetryEvent {
  return {
    source: "repo/telemetry/AUT-1.jsonl",
    work_item_id: "AUT-1",
    model: "claude-opus-5",
    kit_version: "bootstrap",
    emitter: "adapter",
    ...over,
  } as TelemetryEvent;
}

/** 記録が指す作業単位はすべて実在する、という前提の Tracker。 */
function fakeTrackerFor(events: { work_item_id?: unknown }[] = []): TrackerPort {
  const ids = [...new Set(events.map((e) => e.work_item_id).filter((v) => typeof v === "string"))];
  const items = (ids.length > 0 ? ids : ["AUT-1"]).map(
    (id) => ({ id, title: "題", url: "", body: "", state: "started" }) as WorkItemView,
  );
  return {
    async get() { return items[0] ?? null; },
    async list() { return items; },
    async create() { return items[0]; },
    async advance() { return items[0]; },
    async note() {},
  };
}

function input(over: Partial<CheckInput> = {}): CheckInput {
  return {
    repos: [fakeRepo("r")],
    events: [],
    broken: [],
    api: fakeApi(() => ({ status: 200, body: [] })),
    tracker: fakeTrackerFor(over.events ?? []),
    scope: "cross",
    ...over,
  };
}

// --------------------------------------------------------- テレメトリ

test("記録が1件も無ければ失敗", async () => {
  const r = await check("telemetry_recorded").run(input());
  assert.equal(r.state, UNSUBSTITUTED);
});

test("読めない行があれば失敗", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event()], broken: ["repo/x.jsonl:3 JSON として読めない"] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
});

test("必須属性が欠けていれば失敗する。遡って付与できないため代替では埋まらない", async () => {
  const missing = { ...event() } as Record<string, unknown>;
  delete missing.model;
  const r = await check("telemetry_recorded").run(
    input({ events: [missing as TelemetryEvent] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("model")));
});

test("emitter に未定義の値があれば失敗", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [event({ emitter: "human" })] }));
  assert.equal(r.state, UNSUBSTITUTED);
});

test("直書きがあり代替の記録もあれば、未発効・代替あり", async () => {
  const events = [
    event({ emitter: "manual" }),
    event({
      emitter: "manual",
      type: "substitution",
      invariant: "telemetry_recorded",
      detail: "アダプタが無いため直書きしている",
    }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.deepEqual(r.substitutions, ["アダプタが無いため直書きしている"]);
});

test("直書きがあるのに代替の記録が無ければ失敗", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [event({ emitter: "manual" })] }));
  assert.equal(r.state, UNSUBSTITUTED);
});

test("記録が存在しない作業単位を指していれば失敗する", async () => {
  const events = [event({ work_item_id: "AUT-999" })];
  const tracker = fakeTrackerFor([{ work_item_id: "AUT-1" }]);
  const r = await check("telemetry_recorded").run(input({ events, tracker }));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("AUT-999")));
});

test("記録の無い完了済み作業単位は観測として出すが、失敗にはしない", async () => {
  const events = [event()];
  const tracker: TrackerPort = {
    async get() { return null; },
    async list() {
      return [
        { id: "AUT-1", title: "", url: "", body: "", state: "started" },
        { id: "AUT-2", title: "", url: "", body: "", state: "done" },
      ] as WorkItemView[];
    },
    async create() { throw new Error("未使用"); },
    async advance() { throw new Error("未使用"); },
    async note() {},
  };
  const r = await check("telemetry_recorded").run(
    input({ events, tracker, repos: [repoWithHook("r")] }),
  );
  assert.equal(r.state, ACTIVE);
  assert.ok(r.observations.some((o) => o.includes("AUT-2")));
});

test("Tracker の資格情報が無ければ判定不能として失敗する", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [event()], tracker: null }));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("判定できない状態")));
});

test("Tracker が読めなければ判定不能として失敗する", async () => {
  const tracker = fakeTrackerFor();
  tracker.list = async () => { throw new Error("接続できない"); };
  const r = await check("telemetry_recorded").run(input({ events: [event()], tracker }));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("接続できない")));
});

test("self では発効の可否を判定しない。記録が壊れていないかだけを見る", async () => {
  const events = [event({ emitter: "manual" }), event()];
  const r = await check("telemetry_recorded").run(input({ events, scope: "self" }));
  assert.equal(r.state, NOT_IN_SCOPE);
  assert.equal(r.failing, false);
  assert.ok(r.observations.some((o) => o.includes("cross でのみ判定する")));
});

test("self でも壊れた記録は見落とさない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event({ work_item_id: null })], scope: "self" }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
});

test("self では直書きがあっても失敗しない。代替の記録を要求しない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event({ emitter: "manual" })], scope: "self" }),
  );
  assert.equal(r.failing, false);
});

// --------------------------------------------------------- 無効化の検出

test("トークンが無ければ判定不能として失敗する", async () => {
  const r = await check("ai_cannot_disable").run(
    input({ api: fakeApi(() => ({ status: 0, body: {} }), false) }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("判定できない状態")));
});

test("応答が読めない対象があれば失敗する。通してはいけない", async () => {
  const r = await check("ai_cannot_disable").run(
    input({ api: fakeApi(() => ({ status: 500, body: {} })) }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
});

test("origin が無いリポジトリは判定不能として失敗する", async () => {
  const r = await check("ai_cannot_disable").run(input({ repos: [fakeRepo("r", null)] }));
  assert.equal(r.state, UNSUBSTITUTED);
});

test("403 Upgrade はプラン制限として観測し、代替があれば未発効・代替あり", async () => {
  const events = [
    event({
      type: "substitution",
      invariant: "ai_cannot_disable",
      detail: "規約で担保している",
    }),
  ];
  const r = await check("ai_cannot_disable").run(
    input({
      events,
      api: fakeApi(() => ({ status: 403, body: { message: "Upgrade to GitHub Pro" } })),
    }),
  );
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("ruleset を設定できないプラン")));
});

test("403 でも Upgrade 以外は判定不能として扱う", async () => {
  const r = await check("ai_cannot_disable").run(
    input({ api: fakeApi(() => ({ status: 403, body: { message: "Forbidden" } })) }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
});

test("ruleset が0件なら保護されていないとして観測する", async () => {
  const events = [
    event({ type: "substitution", invariant: "ai_cannot_disable", detail: "—" }),
  ];
  const r = await check("ai_cannot_disable").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("ruleset が1件も無い")));
});

// --------------------------------------------------------- 境界

test("boundaries.yaml が無い状態を発効と報告しない", async () => {
  const events = [
    event({ type: "substitution", invariant: "boundary_change_logged", detail: "まだ無い" }),
  ];
  const r = await check("boundary_change_logged").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
});

test("boundaries.yaml があり履歴が無ければ、変更が残っていないとみなす", async () => {
  const repo = {
    ...fakeRepo("r"),
    boundariesFile: () => "/tmp/r/boundaries.yaml",
    boundaryHistoryFile: () => null,
    git: () => "abc1234567890\n",
    read: () => "",
  } as unknown as Repo;
  const events = [
    event({ type: "substitution", invariant: "boundary_change_logged", detail: "—" }),
  ];
  const r = await check("boundary_change_logged").run(input({ repos: [repo], events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("境界変更履歴が無い")));
});

test("全変更コミットが履歴から参照されていれば発効", async () => {
  const repo = {
    ...fakeRepo("r"),
    boundariesFile: () => "/tmp/r/boundaries.yaml",
    boundaryHistoryFile: () => "/tmp/r/boundary-changes.md",
    git: () => "abc1234567890\n",
    read: () => "## 2026-08-21 緩和\n- 設定変更: commit abc1234\n",
  } as unknown as Repo;
  const r = await check("boundary_change_logged").run(input({ repos: [repo] }));
  assert.equal(r.state, ACTIVE);
});

test("履歴から参照されないコミットがあれば発効にしない", async () => {
  const repo = {
    ...fakeRepo("r"),
    boundariesFile: () => "/tmp/r/boundaries.yaml",
    boundaryHistoryFile: () => "/tmp/r/boundary-changes.md",
    git: () => "abc1234567890\ndef9876543210\n",
    read: () => "## 2026-08-21 緩和\n- 設定変更: commit abc1234\n",
  } as unknown as Repo;
  const events = [
    event({ type: "substitution", invariant: "boundary_change_logged", detail: "—" }),
  ];
  const r = await check("boundary_change_logged").run(input({ repos: [repo], events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("def9876")));
});

// --------------------------------------------------------- 実行範囲

test("横断でしか成立しない不変条件は self の対象外", () => {
  assert.equal(check("outer_loop_running").scopes.has("self"), false);
  assert.equal(check("ai_cannot_disable").scopes.has("self"), false);
  assert.equal(check("boundary_change_logged").scopes.has("self"), true);
  assert.equal(check("telemetry_recorded").scopes.has("self"), true);
});

test("work_item_id が null の記録を通さない。属性の存在だけでは足りない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event({ work_item_id: null, type: "tokens" })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("work_item_id")));
});

test("必須属性が空文字の記録も通さない", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [event({ model: "  " })] }));
  assert.equal(r.state, UNSUBSTITUTED);
});

// --------------------------------------------------- 帰属できなかった記録

/** 作業単位に紐づけられなかった記録。置き場と理由の両方を持つ。 */
function unattributed(over: Record<string, unknown> = {}): TelemetryEvent {
  return event({
    source: "repo/telemetry/unattributed.jsonl",
    work_item_id: null,
    type: "tokens",
    unattributed_reason: "作業単位マーカーが無い。起票せずに作業した可能性がある",
    ...over,
  });
}

// **起票せずに作業を始めることを妨げる仕掛けが無い以上、どの作業単位にも属さない
// やり取りは実在する。** 正しく動いた記録を、壊れた記録として失敗にしない。
test("帰属できなかった記録があっても発効できる", async () => {
  const events = [event(), unattributed()];
  const r = await check("telemetry_recorded").run(
    input({ events, repos: [repoWithHook("r")] }),
  );
  assert.equal(r.state, ACTIVE);
});

// **見えなくしない。** 件数は、起票せずに始めた作業の量を示す信号である。
test("帰属できなかった記録の件数と理由を出す", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event(), unattributed(), unattributed()] }),
  );
  assert.ok(
    r.observations.some((o) => o.includes("帰属できなかった記録が 2 件")),
    `件数が出ていない: ${JSON.stringify(r.observations)}`,
  );
  assert.ok(r.observations.some((o) => o.includes("帰属できなかった理由")));
});

// 免除するのは work_item_id だけ。ランタイム由来の属性は帰属できなくても付く。
test("帰属できなかった記録でも、model が欠ければ失敗する", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [unattributed({ model: "" })] }));
  assert.equal(r.state, UNSUBSTITUTED);
  // **「model」を含むかだけでは足りない。** 正常時の観測にも
  // 「必須属性 work_item_id/model/... は全イベントが持つ」という行が出るため、
  // それで通ってしまう。欠けたことを言う行そのものを見る。
  assert.ok(
    r.observations.some((o) => o.startsWith("必須属性が欠けている") && o.includes("model")),
    `欠落を言う観測が無い: ${JSON.stringify(r.observations)}`,
  );
});

// --- 抜け道を塞ぐ ---

test("理由を名乗っても、置き場が違えば免除しない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [unattributed({ source: "repo/telemetry/AUT-1.jsonl" })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.startsWith("必須属性が欠けている") && o.includes("work_item_id")));
});

test("置き場が同じでも、理由が無ければ免除しない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [unattributed({ unattributed_reason: "  " })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.startsWith("必須属性が欠けている") && o.includes("work_item_id")));
});

test("発効境界より前の直書きは、判定の対象から外れる", async () => {
  const events = [
    event({ ts: "2026-01-01T00:00:00Z", emitter: "manual" }),
    event({ ts: "2026-02-01T00:00:00Z", type: "enactment", invariant: "telemetry_recorded" }),
    event({ ts: "2026-03-01T00:00:00Z" }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.ok(r.observations.some((o) => o.includes("発効境界")));
  assert.equal(r.observations.some((o) => o.includes("emitter=manual")), false);
});

test("発効境界より後の直書きは、判定の対象に入る", async () => {
  const events = [
    event({ ts: "2026-02-01T00:00:00Z", type: "enactment", invariant: "telemetry_recorded" }),
    event({ ts: "2026-03-01T00:00:00Z", emitter: "manual" }),
    event({
      ts: "2026-03-01T00:00:00Z",
      type: "substitution",
      invariant: "telemetry_recorded",
      detail: "アダプタが壊れている",
    }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.deepEqual(r.substitutions, ["アダプタが壊れている"]);
});

test("境界を動かした回数を隠さない", async () => {
  const mark = (ts: string) => event({ ts, type: "enactment", invariant: "telemetry_recorded" });
  const events = [mark("2026-02-01T00:00:00Z"), mark("2026-03-01T00:00:00Z"), event({ ts: "2026-04-01T00:00:00Z" })];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.ok(r.observations.some((o) => o.includes("2 回動いている")));
});

test("境界より前でも、必須属性の欠けは見逃さない", async () => {
  const events = [
    event({ ts: "2026-01-01T00:00:00Z", work_item_id: null }),
    event({ ts: "2026-02-01T00:00:00Z", type: "enactment", invariant: "telemetry_recorded" }),
    event({ ts: "2026-03-01T00:00:00Z" }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.equal(r.state, UNSUBSTITUTED);
});

// --------------------------------------------------------- 未発効の結論

test("境界変更履歴にエントリがあっても、代替の記録があれば失敗しない", async () => {
  // 履歴が空でない経路。ここで代替の添付を忘れると UNSUBSTITUTED へ落ちる。
  const repo = {
    ...fakeRepo("r"),
    boundaryHistoryFile: () => "/tmp/r/boundary-changes.md",
    read: () => "## 2026-08-23 初期状態を置いた\n- 設定変更: commit abc1234\n",
  } as unknown as Repo;
  const events = [
    event({ type: "substitution", invariant: "outer_loop_running", detail: "まだ一周していない" }),
  ];
  const r = await check("outer_loop_running").run(input({ repos: [repo], events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.equal(r.failing, false);
  assert.deepEqual(r.substitutions, ["まだ一周していない"]);
});

test("履歴が空の経路でも同じく代替が効く", async () => {
  const events = [
    event({ type: "substitution", invariant: "outer_loop_running", detail: "境界表が無い" }),
  ];
  const r = await check("outer_loop_running").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.equal(r.failing, false);
});

// ------------------------------------------- 提出を経ずに入った変更

const DIRECT_LOG = [
  "bbbbbbb\tp1\tAUT-42 枝を切らずに直接コミット",
  "aaaaaaa\t\t初期化",
].join("\n");

/** プラン制限で ruleset を持てない、いまの構成と同じ状況。 */
function planLimitedApi(submissions: ApiResponse = { status: 200, body: [] }): RepoApi {
  return {
    available: true,
    rulesets: async () => ({ status: 403, body: { message: "Upgrade to GitHub Pro" } }),
    submissionsFor: async () => submissions,
    repository: async () => ({ status: 200, body: { default_branch: "main" } }),
  };
}

// **保護設定を持てなくても、破られたかどうかは見られる。**
test("提出を経ずに既定ブランチへ入った変更があれば失敗する", async () => {
  const repos = [fakeRepo("r", "owner/r", DIRECT_LOG)];
  const r = await check("ai_cannot_disable").run(
    input({ repos, api: planLimitedApi(), events: [event({ type: "substitution", invariant: "ai_cannot_disable", detail: "—" })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(
    r.observations.some((o) => o.includes("提出を経ずに既定ブランチへ入っている") && o.includes("bbbbbbb")),
    `どのコミットかを出していない: ${JSON.stringify(r.observations)}`,
  );
});

// squash マージでは全コミットが非マージになる。コミットの形だけで決めない。
test("統合済みの提出に含まれていれば、直接コミットとしない", async () => {
  const repos = [fakeRepo("r", "owner/r", DIRECT_LOG)];
  const merged = { status: 200, body: [{ merged_at: "2026-08-24T00:00:00Z" }] };
  const r = await check("ai_cannot_disable").run(
    input({ repos, api: planLimitedApi(merged), events: [event({ type: "substitution", invariant: "ai_cannot_disable", detail: "—" })] }),
  );
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("すべて提出を経て入っている")));
});

test("提出を読めなければ、直接コミットの有無を判定しない", async () => {
  const repos = [fakeRepo("r", "owner/r", DIRECT_LOG)];
  const r = await check("ai_cannot_disable").run(
    input({ repos, api: planLimitedApi({ status: 403, body: { message: "Resource not accessible" } }) }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("提出を読めず")), JSON.stringify(r.observations));
});

test("既定ブランチの履歴を読めなければ判定しない", async () => {
  const repos = [fakeRepo("r", "owner/r", null)];
  const r = await check("ai_cannot_disable").run(input({ repos, api: planLimitedApi() }));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("提出を経たかを確かめられない")), JSON.stringify(r.observations));
});

test("すべての判定が、未発効のときに代替の記録を読むこと", async () => {
  // 代替の記録が無ければ、どの判定も UNSUBSTITUTED になる。
  // 添付を忘れた経路があると、代替を置いても失敗したままになり、ここで露見する。
  const withSubstitutions = ["outer_loop_running", "boundary_change_logged", "ai_cannot_disable"];
  for (const key of withSubstitutions) {
    const events = [event({ type: "substitution", invariant: key, detail: "代替あり" })];
    const r = await check(key).run(input({ events }));
    assert.notEqual(r.state, UNSUBSTITUTED, `${key} が代替の記録を読んでいない`);
  }
});
