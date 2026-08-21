import assert from "node:assert/strict";
import { test } from "node:test";
import { boundaryFor, boundaryValueFor, eventsAfter, parseTs } from "../src/enactment.ts";
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
  assert.equal(parseTs(b.since), Date.parse("2026-02-01T00:00:00Z"));
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
  assert.equal(parseTs(b.since), Date.parse("2026-03-01T00:00:00Z"));
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

test("時刻はオフセットを解いて比べる。文字列のまま比べない", () => {
  // 辞書順では 10:00+09:00 が後だが、実時刻では 01:00Z なので先。
  const events = [
    ev("2026-08-22T10:00:00+09:00", { emitter: "manual" }),
    ev("2026-08-22T05:00:00Z", { type: "enactment", invariant: KEY }),
  ];
  const after = eventsAfter(events, boundaryFor(events, KEY));
  assert.equal(after.some((e) => e.emitter === "manual"), false);
});

test("境界は、いまと既存の記録の最大時刻の遅いほうに置く", () => {
  // 手で書かれた記録が実時刻より未来を指していても、境界を進めた時点で
  // 存在していた記録はすべて対象から外れる。
  const now = new Date("2026-08-21T16:00:00Z");
  const events = [ev("2026-08-22T15:00:00+09:00"), ev("2026-08-20T00:00:00Z")];
  const value = boundaryValueFor(events, now);
  assert.equal(parseTs(value), Date.parse("2026-08-22T15:00:00+09:00"));
  assert.equal(eventsAfter(events, { since: value, moves: 1 }).length, 1);
});

test("記録が無ければ境界はいまになる", () => {
  const now = new Date("2026-08-21T16:00:00Z");
  assert.equal(parseTs(boundaryValueFor([], now)), now.getTime());
});

test("印が覆う範囲を持っていれば、印の時刻ではなくそちらを使う", () => {
  const events = [
    ev("2026-08-21T16:00:00Z", { type: "enactment", invariant: KEY, boundary: "2026-08-22T15:00:00+09:00" }),
    ev("2026-08-22T14:00:00+09:00", { emitter: "manual" }),
  ];
  const after = eventsAfter(events, boundaryFor(events, KEY));
  assert.equal(after.some((e) => e.emitter === "manual"), false);
});

test("時刻が読めない記録は判定の対象に残す。壊して逃れる経路を作らない", () => {
  const events = [
    ev("2026-02-01T00:00:00Z", { type: "enactment", invariant: KEY }),
    { source: "s", ts: "こわれた", emitter: "manual" } as unknown as TelemetryEvent,
  ];
  const after = eventsAfter(events, boundaryFor(events, KEY));
  assert.equal(after.some((e) => e.emitter === "manual"), true);
});
