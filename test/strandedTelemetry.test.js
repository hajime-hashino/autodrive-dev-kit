/**
 * 取り残された記録を、拾えること。
 *
 * **拾えたことだけを見ない。** 拾わなくても「拾えた」と出る形になっていないか、
 * 記録以外を巻き込んでいないかまで見る。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commitMessage,
  describeOthers,
  strandedFiles,
  sweep,
} from "../src/strandedTelemetry.js";

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

// ------------------------------------------------------------ 何を書くか

test("コミットの本文が、どの記録を拾ったのかを言う", () => {
  const msg = commitMessage("AUT-156", ["telemetry/AUT-155.jsonl"]);
  assert.match(msg.split("\n")[0], /^AUT-156 /, "件名が、このブランチの作業単位のものでない");
  assert.match(msg, /telemetry\/AUT-155\.jsonl/, "何を拾ったのかが無い");
  assert.match(msg, /最後の1件は必ず後から来る/, "なぜ起きるのかが無い");
});

// ------------------------------------------------------------ 拾う

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

test("取り残しがあれば、コミットする", () => {
  const git = fakeGit({ "status --porcelain -uall": " M telemetry/AUT-155.jsonl" });
  const out = sweep("/repo", "AUT-156", git);

  const committed = git.calls.find((a) => a[0] === "commit");
  assert.ok(committed, "コミットしていない");
  assert.ok(git.calls.some((a) => a[0] === "add"), "add していない");
  // **パスを指していること。** 指さないと、手元の他の変更を巻き込む。
  assert.ok(committed.includes("--"), "パスを指さずにコミットしている");
  assert.ok(committed.includes("telemetry/AUT-155.jsonl"), "対象が渡っていない");
  assert.match(out.join("\n"), /拾って、このブランチへ載せた/);
});

test("取り残しが無ければ、コミットしない", () => {
  const git = fakeGit({ "status --porcelain -uall": " M src/init.js" });
  const out = sweep("/repo", "AUT-156", git);
  assert.deepEqual(out, [], "何も無いのに報告している");
  assert.equal(git.calls.some((a) => a[0] === "commit"), false, "拾うものが無いのにコミットした");
});

// **失敗しても着手は成立させる。ただし黙らない**（`begin` の他の後片付けと同じ）。
test("コミットできなくても、止めずに言う", () => {
  const git = fakeGit({ "status --porcelain -uall": " M telemetry/AUT-155.jsonl" }, ["commit"]);
  const out = sweep("/repo", "AUT-156", git).join("\n");
  assert.match(out, /コミットできなかった/, "黙っている");
  assert.match(out, /一緒に提出すること/, "どうすればよいかが無い");
  assert.match(out, /telemetry\/AUT-155\.jsonl/, "何が残っているのかが無い");
});

test("状態を読めなくても、止めずに言う", () => {
  const git = fakeGit({}, ["status"]);
  const out = sweep("/repo", "AUT-156", git).join("\n");
  assert.match(out, /調べられなかった/, "黙っている");
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
  assert.match(out, /1つの作業単位が/, "なぜ拾えないのかが無い");
  assert.equal(/agent-playground/.test(out), false, "取り残しの無いものを並べている");
});

test("他のリポジトリに何も無ければ、何も言わない", () => {
  assert.deepEqual(describeOthers([{ name: "agent-playground", files: [] }]), []);
  assert.deepEqual(describeOthers([]), []);
});
