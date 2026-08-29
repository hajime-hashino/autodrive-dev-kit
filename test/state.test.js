import assert from "node:assert/strict";
import { test } from "node:test";
import { ACTIVE, Result, SUBSTITUTED, UNSUBSTITUTED } from "../src/state.js";

test("判定していない項目が残っていれば有効にしない", () => {
  const r = new Result("k", "l");
  r.notImplemented("まだ見ていない判定がある");
  r.substitutedBy("人が代替している");
  assert.equal(r.conclude(ACTIVE).state, SUBSTITUTED);
});

test("肩代わりの記録が無ければ失敗として扱う", () => {
  const r = new Result("k", "l");
  assert.equal(r.conclude(SUBSTITUTED).state, UNSUBSTITUTED);
  assert.equal(r.failing, true);
});

test("代替の記録があれば代替なら失敗にしない", () => {
  const r = new Result("k", "l");
  r.substitutedBy("人が代替している");
  assert.equal(r.conclude(SUBSTITUTED).state, SUBSTITUTED);
  assert.equal(r.failing, false);
});

test("未実装が無く代替も要らなければ有効になる", () => {
  const r = new Result("k", "l");
  assert.equal(r.conclude(ACTIVE).state, ACTIVE);
  assert.equal(r.failing, false);
});

test("判定前に状態を読むと落ちる", () => {
  assert.throws(() => new Result("k", "l").state, /判定が終わっていない/);
});
