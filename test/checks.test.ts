import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECKS } from "../src/checks.ts";
import type { CheckInput } from "../src/checks.ts";
import type { Repo } from "../src/repos.ts";
import type { ApiResponse, RepoApi } from "../src/repoApi.ts";
import { ACTIVE, SUBSTITUTED, UNSUBSTITUTED } from "../src/state.ts";
import type { TelemetryEvent } from "../src/telemetry.ts";

function check(key: string) {
  const found = CHECKS.find((c) => c.key === key);
  assert.ok(found, `判定が登録されていない: ${key}`);
  return found;
}

function fakeRepo(name: string, slug: string | null = `owner/${name}`): Repo {
  return {
    name,
    path: `/tmp/${name}`,
    remoteSlug: () => slug,
    boundariesFile: () => null,
    boundaryHistoryFile: () => null,
    telemetryFiles: () => [],
    git: () => null,
    read: () => "",
  } as unknown as Repo;
}

function fakeApi(responder: (slug: string) => ApiResponse, available = true): RepoApi {
  return { available, rulesets: async (slug) => responder(slug) };
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

function input(over: Partial<CheckInput> = {}): CheckInput {
  return {
    repos: [fakeRepo("r")],
    events: [],
    broken: [],
    api: fakeApi(() => ({ status: 200, body: [] })),
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

test("全件アダプタ経由でも、網羅率が未実装のうちは発効にしない", async () => {
  const events = [
    event(),
    event({ type: "substitution", invariant: "telemetry_recorded", detail: "—" }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.notEqual(r.state, ACTIVE);
  assert.ok(r.unimplemented.some((u) => u.includes("網羅率")));
});

test("self では横断の網羅を判定しないことを明示する", async () => {
  const events = [
    event({ emitter: "manual" }),
    event({ type: "substitution", invariant: "telemetry_recorded", detail: "—" }),
  ];
  const r = await check("telemetry_recorded").run(input({ events, scope: "self" }));
  assert.ok(r.unimplemented.some((u) => u.includes("cross でのみ判定する")));
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
