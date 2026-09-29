/**
 * 取り残された記録に、気づけること。
 *
 * **拾わないことを判定する。** 以前は拾ってコミットしていたが、それは別の作業単位の
 * 記録を、いま着手した作業単位の提出に載せる形だった（AUT-162）。**気づけることと、
 * 勝手に載せることは違う。**
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOthers, detect, strandedFiles } from "../src/vendored/internal/strandedTelemetry.js";

// ------------------------------------------------------------ 何を拾うか

test("未コミットの記録を拾う", () => {
  const out = strandedFiles([
    " M telemetry/AUT-155.jsonl",
    "?? telemetry/AUT-156.jsonl",
  ].join("\n"));
  assert.deepEqual(out, ["telemetry/AUT-155.jsonl", "telemetry/AUT-156.jsonl"]);
});

// **記録以外を巻き込まない。** まとめてコミットすると、作業中のものを勝手に履歴へ
// 載せることになる。
test("記録以外には触らない", () => {
  const out = strandedFiles([
    " M src/init.js",
    " M telemetry/AUT-155.jsonl",
    "?? notes/下書き.md",
    " M docs/adr/README.md",
    "?? .env",
  ].join("\n"));
  assert.deepEqual(out, ["telemetry/AUT-155.jsonl"]);
});

test("記録に見えて、記録でないものを拾わない", () => {
  for (const path of [
    " M telemetry/README.md",          // 記録ではない
    " M telemetry/古い/AUT-1.jsonl",    // 直下ではない
    " M src/telemetry/AUT-1.jsonl",    // 別の場所
    " M telemetryAUT-1.jsonl",         // 区切りが無い
    "?? telemetry/",                   // ディレクトリそのもの
  ]) {
    assert.deepEqual(strandedFiles(path), [], `拾ってはいけないものを拾った: ${path}`);
  }
});

test("名前が変わったものは、変わった後の名前で拾う", () => {
  assert.deepEqual(
    strandedFiles("R  telemetry/AUT-1.jsonl -> telemetry/AUT-2.jsonl"),
    ["telemetry/AUT-2.jsonl"],
  );
});

test("同じものを二度拾わない", () => {
  const out = strandedFiles(" M telemetry/AUT-1.jsonl\nMM telemetry/AUT-1.jsonl");
  assert.deepEqual(out, ["telemetry/AUT-1.jsonl"]);
});

test("何も無ければ、何も拾わない", () => {
  for (const empty of ["", "\n", null, undefined]) {
    assert.deepEqual(strandedFiles(empty), [], "空回りしている");
  }
});

// ------------------------------------------------------- 気づく（拾わない）

/** 呼ばれた git の引数を残す。 */
function fakeGit(responses = {}, fails = []) {
  const calls = [];
  const git = (_repoPath, args) => {
    calls.push(args);
    const key = args.join(" ");
    for (const f of fails) if (key.startsWith(f)) throw new Error(`git ${key} が失敗`);
    return responses[key] ?? "";
  };
  git.calls = calls;
  return git;
}

// **これが AUT-162 の眼目である。** 気づくことと、勝手にコミットすることは違う。
test("取り残しがあっても、コミットしない", () => {
  const git = fakeGit({ "status --porcelain -uall": " M telemetry/AUT-155.jsonl" });
  const out = detect("/repo", git).join("\n");

  assert.equal(git.calls.some((a) => a[0] === "commit"), false, "拾ってコミットしている");
  assert.equal(git.calls.some((a) => a[0] === "add"), false, "add している");
  // **黙らない。** 残っていることと、どうすればよいかを言う。
  assert.match(out, /There are records left behind/, "黙っている");
  assert.match(out, /telemetry\/AUT-155\.jsonl/, "何が残っているのかが無い");
  assert.match(out, /put them on that branch/, "どうすればよいかが無い");
});

test("取り残しが無ければ、何も言わない", () => {
  const git = fakeGit({ "status --porcelain -uall": " M src/init.js" });
  assert.deepEqual(detect("/repo", git), [], "記録以外に反応している");
});

test("状態を読めなくても、止めずに言う", () => {
  const git = fakeGit({}, ["status"]);
  assert.match(detect("/repo", git).join("\n"), /Could not check/, "黙っている");
});

// ------------------------------------------------------------ 他のリポジトリ

test("他のリポジトリの取り残しを、あると言う", () => {
  const out = describeOthers([
    { name: "autodrive-dev-work", files: ["telemetry/AUT-148.jsonl"] },
    { name: "agent-playground", files: [] },
  ]).join("\n");
  assert.match(out, /autodrive-dev-work/);
  assert.match(out, /telemetry\/AUT-148\.jsonl/);
  // **拾わない理由まで言う。** 言わないと、拾い忘れに見える。
  assert.match(out, /writes to only one repository/, "なぜ拾えないのかが無い");
  assert.equal(/agent-playground/.test(out), false, "取り残しの無いものを並べている");
});

test("他のリポジトリに何も無ければ、何も言わない", () => {
  assert.deepEqual(describeOthers([{ name: "agent-playground", files: [] }]), []);
  assert.deepEqual(describeOthers([]), []);
});
