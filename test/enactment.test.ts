import assert from "node:assert/strict";
import { test } from "node:test";
import { boundaryFor, eventsAfter } from "../src/enactment.ts";
import type { TelemetryEvent } from "../src/telemetry.ts";

function ev(ts: string, over: Record<string, unknown> = {}): TelemetryEvent {
  return { source: "r/telemetry/x.jsonl", ts, emitter: "adapter", ...over } as TelemetryEvent;
}

const KEY = "telemetry_recorded";
const mark = (ts: string) => ev(ts, { type: "enactment", invariant: KEY });

test("印が無ければ全期間が判定の対象", () => {
  const events = [ev("2026-01-01T00:00:00Z"), ev("2026-02-01T00:00:00Z")];
  const b = boundaryFor(events, KEY);
  assert.equal(b.since, null);
  assert.equal(b.moves, 0);
  assert.equal(eventsAfter(events, b).length, 2);
});

test("印以降だけが判定の対象になる。印より前の記録は消さない", () => {
  const events = [
    ev("2026-01-01T00:00:00Z", { emitter: "manual" }),
    mark("2026-02-01T00:00:00Z"),
    ev("2026-03-01T00:00:00Z"),
  ];
  const b = boundaryFor(events, KEY);
  assert.equal(b.since, "2026-02-01T00:00:00Z");
  const after = eventsAfter(events, b);
  assert.equal(after.length, 2);
  assert.equal(after.some((e) => e.emitter === "manual"), false);
  // 元の配列は変わらない。履歴としては残り続ける。
  assert.equal(events.length, 3);
});

test("印は最後のものが効く。動かした回数も数える", () => {
  const events = [
    mark("2026-02-01T00:00:00Z"),
    ev("2026-02-15T00:00:00Z", { emitter: "manual" }),
    mark("2026-03-01T00:00:00Z"),
    ev("2026-03-02T00:00:00Z"),
  ];
  const b = boundaryFor(events, KEY);
  assert.equal(b.since, "2026-03-01T00:00:00Z");
  assert.equal(b.moves, 2);
  assert.equal(eventsAfter(events, b).some((e) => e.emitter === "manual"), false);
});

test("別の不変条件の印は効かない", () => {
  const events = [ev("2026-02-01T00:00:00Z", { type: "enactment", invariant: "outer_loop_running" })];
  assert.equal(boundaryFor(events, KEY).since, null);
});

test("印より後に直書きが現れれば、再び判定の対象に入る", () => {
  const events = [mark("2026-02-01T00:00:00Z"), ev("2026-04-01T00:00:00Z", { emitter: "manual" })];
  const after = eventsAfter(events, boundaryFor(events, KEY));
  assert.equal(after.some((e) => e.emitter === "manual"), true);
});
