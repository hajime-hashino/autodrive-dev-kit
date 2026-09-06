import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { record } from "../src/recordTokens.js";
import { tempDir } from "./helpers/tmp.js";

function assistant(model , requestId , usage) {
  return JSON.stringify({
    type: "assistant",
    uuid: `u-${requestId}`,
    requestId,
    message: { model, usage },
  });
}

function fixture(lines) {
  const root = tempDir("autodrive-");
  const transcript = join(root, "session.jsonl");
  writeFileSync(transcript, `${lines.join("\n")}\n`, "utf8");
  return { root, transcript };
}

function markWorkItem(root , id , repo) {
  // **対象リポジトリを実際に置く。** 一部の判定はこれを置かずに通っていたが、
  // それは無い場所をディレクトリごと作っていたからである（AUT-143）。
  mkdirSync(join(root, repo), { recursive: true });
  mkdirSync(join(root, ".autodrive"), { recursive: true });
  writeFileSync(
    join(root, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: id, repo }),
    "utf8",
  );
}

function events(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) );
}

test("使用量をモデル別に集計して記録する", () => {
  const { root, transcript } = fixture([
    assistant("claude-opus-5", "r1", { input_tokens: 10, output_tokens: 20 }),
    assistant("claude-opus-5", "r2", { output_tokens: 5, cache_read_input_tokens: 100 }),
    assistant("claude-haiku-4-5", "r3", { input_tokens: 1, output_tokens: 2 }),
  ]);
  markWorkItem(root, "AUT-10", "kit");
  mkdirSync(join(root, "kit"), { recursive: true });

  const result = record({ transcript_path: transcript, session_id: "s1" }, root);
  assert.equal(result.written, 2);

  const written = events(join(root, "kit", "telemetry", "AUT-10.jsonl"));
  const opus = written.find((e) => e.model === "claude-opus-5");
  assert.equal(opus?.responses, 2);
  assert.equal(opus?.output_tokens, 25);
  assert.equal(opus?.cache_read_input_tokens, 100);
  assert.equal(opus?.emitter, "adapter");
  assert.equal(opus?.work_item_id, "AUT-10");
});

test("同じ応答を二重に集計しない", () => {
  const { root, transcript } = fixture([
    assistant("claude-opus-5", "r1", { output_tokens: 7 }),
    // 同一応答が複数行に分かれることがある
    assistant("claude-opus-5", "r1", { output_tokens: 7 }),
  ]);
  markWorkItem(root, "AUT-10", "kit");
  record({ transcript_path: transcript, session_id: "s1" }, root);
  const written = events(join(root, "kit", "telemetry", "AUT-10.jsonl"));
  assert.equal(written[0].responses, 1);
  assert.equal(written[0].output_tokens, 7);
});

test("2回目の実行では、追記された分だけを記録する", () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");
  record({ transcript_path: transcript, session_id: "s1" }, root);

  writeFileSync(
    transcript,
    `${readFileSync(transcript, "utf8")}${assistant("claude-opus-5", "r2", { output_tokens: 3 })}\n`,
    "utf8",
  );
  const second = record({ transcript_path: transcript, session_id: "s1" }, root);
  assert.equal(second.written, 1);

  const written = events(join(root, "kit", "telemetry", "AUT-10.jsonl"));
  assert.equal(written.length, 2);
  assert.equal(written[1].output_tokens, 3);
});

test("新しい使用量が無ければ何も書かない", () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");
  record({ transcript_path: transcript, session_id: "s1" }, root);
  const again = record({ transcript_path: transcript, session_id: "s1" }, root);
  assert.equal(again.written, 0);
});

test("作業単位が解決できなければ work_item_id を null で残す。握りつぶさない", () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  const result = record({ transcript_path: transcript, session_id: "s1" }, root);
  assert.equal(result.written, 1);

  const written = events(join(root, "telemetry", "unattributed.jsonl"));
  assert.equal(written[0].work_item_id, null);
  assert.ok(String(written[0].unattributed_reason).includes("マーカーが無い"));
});

// **原因の違うものを同じ言葉で報告しない。** 定義§6（v0.10）は、作業単位に
// 帰属しないやり取りが実在することを認める一方、帰属できるものは必ず紐づける
// ことを求める。マーカーが壊れている場合は帰属できたはずの記録であり、そもそも
// 紐づく先が無い場合とは意味が違う。
test("マーカーが壊れている場合と、無い場合を見分ける", () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  mkdirSync(join(root, ".autodrive"), { recursive: true });
  writeFileSync(join(root, ".autodrive", "current-work-item.json"), "{ これは JSON ではない", "utf8");
  record({ transcript_path: transcript, session_id: "s1" }, root);

  const reason = String(events(join(root, "telemetry", "unattributed.jsonl"))[0].unattributed_reason);
  assert.ok(reason.includes("読めない"), `壊れていることを言っていない: ${reason}`);
  assert.ok(!reason.includes("マーカーが無い"), `無い場合と同じ言葉になっている: ${reason}`);
});

test("マーカーの内容が欠けている場合も、無い場合と見分ける", () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  mkdirSync(join(root, ".autodrive"), { recursive: true });
  writeFileSync(
    join(root, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-1", repo: "" }),
    "utf8",
  );
  record({ transcript_path: transcript, session_id: "s1" }, root);

  const reason = String(events(join(root, "telemetry", "unattributed.jsonl"))[0].unattributed_reason);
  assert.ok(reason.includes("欠けている"), `欠落を言っていない: ${reason}`);
  assert.ok(reason.includes("repo"), `どれが欠けたかを言っていない: ${reason}`);
  assert.ok(!reason.includes("マーカーが無い"), `無い場合と同じ言葉になっている: ${reason}`);
});

test("壊れた行があっても他の行の集計を止めない", () => {
  const { root, transcript } = fixture([
    assistant("claude-opus-5", "r1", { output_tokens: 7 }),
    "{ これは JSON ではない",
    assistant("claude-opus-5", "r2", { output_tokens: 3 }),
  ]);
  markWorkItem(root, "AUT-10", "kit");
  record({ transcript_path: transcript, session_id: "s1" }, root);
  const written = events(join(root, "kit", "telemetry", "AUT-10.jsonl"));
  assert.equal(written[0].output_tokens, 10);
});

test("セッション記録が読めなくても落ちない", () => {
  const root = tempDir("autodrive-");
  const result = record({ transcript_path: join(root, "無い.jsonl"), session_id: "s1" }, root);
  assert.equal(result.written, 0);
});

test("必要な入力が欠けていれば何もしない", () => {
  const root = tempDir("autodrive-");
  assert.equal(record({}, root).written, 0);
  assert.equal(existsSync(join(root, "telemetry")), false);
});

test("セッション識別子はパスに使えない文字を含んでいても安全に扱う", () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");
  record({ transcript_path: transcript, session_id: "../../逃走" }, root);
  assert.equal(existsSync(join(root, ".autodrive", "cursors")), true);
});
