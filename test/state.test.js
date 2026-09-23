import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ACTIVE, Result, SUBSTITUTED, UNSUBSTITUTED } from "../src/vendored/internal/state.js";
import {
  findSessionState,
  readSessionState,
  writeSessionState,
} from "../src/vendored/internal/sessionState.js";
import { JsonlTelemetry } from "../src/vendored/internal/adapters/telemetryJsonl.js";
import { STATE_DIR } from "../src/vendored/internal/workItem.js";
import { tempDir } from "./helpers/tmp.js";

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

// ------------------------------------------- セッションの記録を探す（AUT-231）

/**
 * **書く場所は1つ、読む場所は多い。**
 *
 * セッションの記録はフックが走った場所（作業場の起点）にだけ書かれるが、
 * 記録は子リポジトリの中から打たれる。**起点の探し上げは `.autodrive` を持つ
 * 最初のディレクトリで止まる**ため、子で止まってしまう。
 *
 * AUT-221 で作業状態のマーカーを両方の起点へ置くようにしたことで、子が
 * `.autodrive` を持つようになり、**必須属性の `model` が直近10件のうち6件で
 * 欠けた。** 後から遡って付与できない（定義§6）。
 */
function workspace() {
  const root = tempDir("autodrive-session-");
  const child = join(root, "child");
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  // **子も `.autodrive` を持つ。** AUT-221 以降の実際の形である。
  mkdirSync(join(child, STATE_DIR), { recursive: true });
  return { root, child };
}

test("子に器だけがあっても、上にある記録を見つける", () => {
  const { root, child } = workspace();
  writeSessionState(root, { session_id: "s", last_model: "claude-opus-5", updated: "t" });

  // **器があることと、中身があることは違う。**
  assert.equal(existsSync(join(child, STATE_DIR)), true, "前提が崩れている");
  assert.equal(readSessionState(child).last_model, "claude-opus-5");
});

test("子に記録があれば、そちらを採る", () => {
  const { root, child } = workspace();
  writeSessionState(root, { session_id: "s", last_model: "上", updated: "t" });
  writeSessionState(child, { session_id: "s", last_model: "下", updated: "t" });

  assert.equal(readSessionState(child).last_model, "下", "近いほうを採っていない");
});

test("どこにも無ければ、空を返す", () => {
  const { child } = workspace();

  assert.equal(findSessionState(child), null);
  assert.equal(readSessionState(child).last_model, null);
});

test("読めない記録は、空として扱う", () => {
  const { root, child } = workspace();
  writeFileSync(join(root, STATE_DIR, "session.json"), "{ これは JSON ではない", "utf8");

  assert.equal(readSessionState(child).last_model, null);
});

// **必須属性が埋まること。** ここが本題である。
test("子リポジトリから記録しても、model が埋まる", () => {
  const { root, child } = workspace();
  writeSessionState(root, { session_id: "s", last_model: "claude-opus-5", updated: "t" });
  writeFileSync(
    join(child, STATE_DIR, "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-1", repo: "child" }),
    "utf8",
  );
  mkdirSync(join(child, ".git"), { recursive: true });

  const telemetry = new JsonlTelemetry(child);
  telemetry.recordStop("種別", "入力", "内容");

  const written = readFileSync(telemetry.lastWrite.path, "utf8").trim().split("\n");
  const event = JSON.parse(written[written.length - 1]);
  assert.equal(event.model, "claude-opus-5", "必須属性が埋まっていない");
  assert.equal(event.model_unavailable_reason, undefined, "埋まっているのに理由が付いている");
});

// **理由を断定しない。** 確かめていたのは1箇所の不在だけだった。誤った理由が
// 残ると、読んだ人が別の場所を探さなくなる。
test("見つからないときの理由が、まだ無いと断定しない", () => {
  const { child } = workspace();
  writeFileSync(
    join(child, STATE_DIR, "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-1", repo: "child" }),
    "utf8",
  );
  mkdirSync(join(child, ".git"), { recursive: true });

  const telemetry = new JsonlTelemetry(child);
  telemetry.recordStop("種別", "入力", "内容");

  const written = readFileSync(telemetry.lastWrite.path, "utf8").trim().split("\n");
  const event = JSON.parse(written[written.length - 1]);
  assert.equal(event.model, null);
  assert.match(event.model_unavailable_reason, /上へ辿って探した/);
});
