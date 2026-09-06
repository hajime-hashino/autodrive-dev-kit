/**
 * 出力の見え方。
 *
 * **ここが人の目に触れる面である。** 判定が正しくても、状態の名前が変われば
 * 読む側の結論が変わる。名前を変えたときに、変えたつもりのないものまで変わって
 * いないかを見る。
 *
 * 実際に、これまでここには判定が無かった。**語彙を入れ替えても何も落ちなかった。**
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { renderText } from "../src/report.js";
import { ACTIVE, NOT_IN_SCOPE, Result, SUBSTITUTED, UNSUBSTITUTED } from "../src/state.js";


const repos = [{ name: "my-app" }];

function resultWith(state , key) {
  const r = new Result(key);
  r.observe("見たこと");
  if (state === SUBSTITUTED) r.substitutedBy("人が肩代わりしている");
  r.conclude(state);
  return r;
}

// **4つの状態それぞれに名前があること**（定義§9 v0.12）。
test("状態の名前が、定義のとおりに出る", () => {
  const out = renderText(
    [
      resultWith(ACTIVE, "telemetry_recorded"),
      resultWith(SUBSTITUTED, "ai_cannot_disable"),
      resultWith(UNSUBSTITUTED, "boundary_change_logged"),
      resultWith(NOT_IN_SCOPE, "outer_loop_running"),
    ],
    repos,
    "self",
  );

  assert.match(out, /\[有効\] {4}テレメトリが記録されること|\[有効\] テレメトリが記録されること/);
  assert.ok(out.includes("[代替]"), out);
  assert.ok(out.includes("[要対応]"), out);
  assert.ok(out.includes("[対象外]"), out);

  // **古い名前が残っていないこと。** 混ざると、同じものに名前が2つある状態になる。
  for (const old of ["発効", "未発効"]) {
    assert.equal(out.includes(old), false, `古い名前が残っている: ${old}\n${out}`);
  }
});

// **状態の不在ではなく、いま何であるかを言う。** 「未有効」は4つの状態のどれでも
// ない（定義 v0.12 の CHANGELOG）。
test("状態の不在を名前にしない", () => {
  const out = renderText([resultWith(SUBSTITUTED, "何か")], repos, "self");
  assert.equal(out.includes("未有効"), false, out);
  assert.ok(out.includes("[代替]"), out);
});

// **失敗は要対応だけである**（定義§9の立ち上げ期の例外）。
test("代替は失敗として出さない", () => {
  const ok = renderText([resultWith(SUBSTITUTED, "何か")], repos, "self");
  assert.equal(ok.includes("失敗:"), false, ok);

  const ng = renderText([resultWith(UNSUBSTITUTED, "何か")], repos, "self");
  assert.ok(ng.includes("失敗:"), ng);
  // 何が失敗なのかを言い添える。**状態の名前だけでは、何をすればよいか分からない。**
  assert.ok(ng.includes("肩代わりの記録が無い"), ng);
});

test("見出しが、何を判定したかを言う", () => {
  const out = renderText([resultWith(ACTIVE, "何か")], repos, "self");
  assert.ok(out.startsWith("不変条件の状態"), out.slice(0, 40));
});

// ------------------------- 相手の言語で出す（AUT-135）

// **CI の失敗ログは人が直接読む。** AIが介在しないので、ここは相手の言語が要る。
test("英語の設定なら、判定の出力も英語になる", () => {
  const out = renderText([resultWith(ACTIVE, "telemetry_recorded")], repos, "self", "en");
  assert.match(out, /^Invariant status/, out.slice(0, 80));
  assert.match(out, /\[active\] Telemetry is being recorded/, out);
  assert.ok(!/不変条件|有効/.test(out.split("observed")[0]), `枠が日本語のまま: ${out}`);
});

test("既定は日本語のまま", () => {
  const out = renderText([resultWith(ACTIVE, "telemetry_recorded")], repos, "self");
  assert.match(out, /^不変条件の状態/);
  assert.match(out, /\[有効\] テレメトリが記録されること/);
});

// **観測の中身は日本語のままである。黙って混ぜない。**
test("観測が日本語であることを、英語の出力では断る", () => {
  const withDetail = renderText([resultWith(ACTIVE, "telemetry_recorded")], repos, "self", "en");
  assert.ok(withDetail.includes("in Japanese"), "断っていない");

  const r = new Result("telemetry_recorded");
  r.conclude(ACTIVE);
  assert.equal(
    renderText([r], repos, "self", "en").includes("in Japanese"),
    false,
    "観測が無いのに断っている",
  );
});

// **名前の出どころは1つ。** 2か所に置くと、片方だけ古くなる。
test("不変条件の名前が、定義の語彙と揃っている", () => {
  const out = renderText([resultWith(UNSUBSTITUTED, "boundary_change_logged")], repos, "self");
  assert.match(out, /委譲範囲の変更が履歴に残ること/, "定義 v0.14 の語彙になっていない");
  assert.ok(!out.includes("境界変更"), `旧名が残っている: ${out}`);
});
