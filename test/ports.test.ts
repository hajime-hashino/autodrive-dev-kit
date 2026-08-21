import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run as telemetryRun } from "../src/telemetryCli.ts";
import { run as trackerRun } from "../src/trackerCli.ts";
import type { CreateInput, TrackerPort, WorkItemState, WorkItemView } from "../src/ports/tracker.ts";

function root(): string {
  return mkdtempSync(join(tmpdir(), "autodrive-ports-"));
}

function withWorkItem(id: string, repo: string): string {
  const r = root();
  mkdirSync(join(r, ".autodrive"), { recursive: true });
  writeFileSync(
    join(r, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: id, repo }),
    "utf8",
  );
  writeFileSync(
    join(r, ".autodrive", "session.json"),
    JSON.stringify({ session_id: "s1", last_model: "claude-opus-5", updated: "2026-08-22T00:00:00Z" }),
    "utf8",
  );
  return r;
}

function readEvents(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// --------------------------------------------------------- Telemetry

test("停止を記録すると、必須属性がアダプタ側で付く", () => {
  const r = withWorkItem("AUT-12", "kit");
  const res = telemetryRun(
    ["停止を記録する", "--kind", "approval_required", "--detail", "承認を待つ", "--root", r],
    r,
  );
  assert.equal(res.code, 0);
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  assert.equal(event.type, "stop");
  assert.equal(event.stop_kind, "approval_required");
  assert.equal(event.work_item_id, "AUT-12");
  assert.equal(event.model, "claude-opus-5");
  assert.equal(event.kit_version, "bootstrap");
  assert.equal(event.emitter, "adapter");
});

test("検出漏れは独立した操作を持たず、発見された工程で表す", () => {
  const r = withWorkItem("AUT-12", "kit");
  telemetryRun(
    ["修正を記録する", "--target", "verify", "--detail", "本番で判明", "--found-in", "本番", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  assert.equal(event.type, "miss");
  assert.equal(event.found_in, "本番");
});

test("発見された工程が無ければ手戻りとして記録し、原因を持たせる", () => {
  const r = withWorkItem("AUT-12", "kit");
  telemetryRun(
    ["修正を記録する", "--target", "src", "--detail", "直した", "--cause", "設計のズレ", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  assert.equal(event.type, "rework");
  assert.equal(event.cause, "設計のズレ");
});

test("定義に無い原因は受け付けない", () => {
  const r = withWorkItem("AUT-12", "kit");
  const res = telemetryRun(
    ["修正を記録する", "--target", "x", "--detail", "y", "--cause", "なんとなく", "--root", r],
    r,
  );
  assert.equal(res.code, 2);
});

test("境界変更を記録する", () => {
  const r = withWorkItem("AUT-12", "kit");
  telemetryRun(
    ["境界変更を記録する", "--area", "UI実装", "--from", "観察中", "--to", "委譲済み",
     "--detail", "12件で修正なし", "--basis", "観察中12件", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  assert.equal(event.type, "boundary_change");
  assert.equal(event.from, "観察中");
  assert.equal(event.basis, "観察中12件");
});

test("作業単位に紐づかない記録は残すが、成功として返さない", () => {
  const r = root();
  const res = telemetryRun(["停止を記録する", "--kind", "k", "--detail", "d", "--root", r], r);
  assert.equal(res.code, 1);
  const [event] = readEvents(join(r, "telemetry", "unattributed.jsonl"));
  assert.equal(event.work_item_id, null);
});

test("必須の引数が無ければ実行しない", () => {
  const r = withWorkItem("AUT-12", "kit");
  assert.equal(telemetryRun(["停止を記録する", "--detail", "d", "--root", r], r).code, 2);
  assert.equal(telemetryRun(["停止を記録する", "--kind", "k", "--root", r], r).code, 2);
});

// --------------------------------------------------------- Tracker

function fakeTracker(): TrackerPort & { advanced: [string, WorkItemState][] } {
  const advanced: [string, WorkItemState][] = [];
  const view = (id: string, state: WorkItemState): WorkItemView => ({
    id, state, title: "題", url: `https://example.invalid/${id}`, body: "本文",
  });
  return {
    advanced,
    async get(id?: string) {
      return view(id ?? "AUT-99", "todo");
    },
    async create(input: CreateInput) {
      return { ...view("AUT-100", "backlog"), title: input.title, body: input.body };
    },
    async advance(id: string, to: WorkItemState) {
      advanced.push([id, to]);
      return view(id, to);
    },
    async note() {},
  };
}

test("着手すると、記録の紐づけ先が置かれる", async () => {
  const r = root();
  const t = fakeTracker();
  const res = await trackerRun(["状態を進める", "AUT-12", "--to", "started", "--repo", "kit"], r, t);
  assert.equal(res.code, 0);
  const marker = JSON.parse(readFileSync(join(r, ".autodrive", "current-work-item.json"), "utf8"));
  assert.deepEqual(marker, { work_item_id: "AUT-12", repo: "kit" });
});

test("着手には書き込み先が要る。決まらなければ進めない", async () => {
  const r = root();
  const res = await trackerRun(["状態を進める", "AUT-12", "--to", "started"], r, fakeTracker());
  assert.equal(res.code, 2);
  assert.equal(existsSync(join(r, ".autodrive", "current-work-item.json")), false);
});

test("完了すると紐づけ先を外す。別の作業単位の記録が紛れ込まないように", async () => {
  const r = root();
  const t = fakeTracker();
  await trackerRun(["状態を進める", "AUT-12", "--to", "started", "--repo", "kit"], r, t);
  await trackerRun(["状態を進める", "AUT-12", "--to", "done"], r, t);
  assert.equal(existsSync(join(r, ".autodrive", "current-work-item.json")), false);
});

test("別の作業単位を完了しても、いまの紐づけ先は外さない", async () => {
  const r = root();
  const t = fakeTracker();
  await trackerRun(["状態を進める", "AUT-12", "--to", "started", "--repo", "kit"], r, t);
  await trackerRun(["状態を進める", "AUT-11", "--to", "done"], r, t);
  assert.equal(existsSync(join(r, ".autodrive", "current-work-item.json")), true);
});

test("定義に無い状態へは進めない", async () => {
  const r = root();
  const res = await trackerRun(["状態を進める", "AUT-12", "--to", "レビュー中"], r, fakeTracker());
  assert.equal(res.code, 2);
});

test("起票には題と本文が要る", async () => {
  const r = root();
  assert.equal((await trackerRun(["作業単位を起票する", "--title", "t"], r, fakeTracker())).code, 2);
});
