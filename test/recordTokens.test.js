import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { record } from "../src/vendored/internal/recordTokens.js";
import { readSessionState } from "../src/vendored/internal/sessionState.js";
import { tempDir } from "./helpers/tmp.js";

function assistant(model, requestId, usage) {
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

function markWorkItem(root, id, repo) {
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

/** 送り先が設定されている構成。 */
const CONFIGURED = {
  AUTODRIVE_OTLP_ENDPOINT: "https://example.invalid/api/public/otel/v1/traces",
  AUTODRIVE_OTLP_HEADERS: "Authorization=Basic cGs6c2s=,x-langfuse-ingestion-version=4",
};

/**
 * 送らずに、送ろうとした中身を捉える。
 *
 * **本物の宛先を叩かない。** 判定が外の状態に依存すると、落ちた理由がこちらの
 * 誤りなのか相手の不調なのか分からなくなる。
 */
function capturing({ ok = true } = {}) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(String(init.body)) });
    return { ok, status: ok ? 200 : 500 };
  };
  return { sent, deps: { fetchImpl } };
}

/** 送った中身から、モデル別の属性表を取り出す。 */
function spansOf(sent) {
  return sent[0].body.resourceSpans[0].scopeSpans[0].spans.map((span) => {
    const attrs = {};
    for (const a of span.attributes) {
      attrs[a.key] = a.value.stringValue ?? Number(a.value.intValue);
    }
    return attrs;
  });
}

test("使用量をモデル別に送る", async () => {
  const { root, transcript } = fixture([
    assistant("claude-opus-5", "r1", { input_tokens: 10, output_tokens: 20 }),
    assistant("claude-opus-5", "r2", { output_tokens: 5, cache_read_input_tokens: 100 }),
    assistant("claude-haiku-4-5", "r3", { input_tokens: 1, output_tokens: 2 }),
  ]);
  markWorkItem(root, "AUT-10", "kit");

  const { sent, deps } = capturing();
  const result = await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);
  assert.equal(result.sent, 2);

  const spans = spansOf(sent);
  const opus = spans.find((s) => s["langfuse.observation.model.name"] === "claude-opus-5");
  // **モデルを混ぜない。** 受け側は model と量から費用を出すため、合算すると出せない。
  assert.equal(opus?.["langfuse.observation.metadata.responses"], 2);
  const usage = JSON.parse(String(opus?.["langfuse.observation.usage_details"]));
  assert.equal(usage.output, 25);
  assert.equal(usage.cache_read_input_tokens, 100);
  // **作業単位IDは observation にも付ける。** trace にだけ付けると絞り込めない。
  assert.equal(opus?.["langfuse.observation.metadata.work_item_id"], "AUT-10");
  assert.equal(opus?.["langfuse.session.id"], "s1");
});

// **これが AUT-162 の眼目である。** リポジトリへ書かないこと自体を判定する。
test("リポジトリのどこにも記録を書かない", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");

  const { deps } = capturing();
  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);

  assert.equal(existsSync(join(root, "kit", "telemetry")), false, "対象リポジトリへ書いている");
  assert.equal(existsSync(join(root, "telemetry")), false, "起点へ書いている");
});

test("認証の見出しを、そのまま渡す", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");

  const { sent, deps } = capturing();
  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);

  assert.equal(sent[0].url, CONFIGURED.AUTODRIVE_OTLP_ENDPOINT);
  // **値に `=` が入る。** base64 は `=` で終わるため、最初の `=` だけで割る必要がある。
  assert.equal(sent[0].init.headers.Authorization, "Basic cGs6c2s=");
  assert.equal(sent[0].init.headers["x-langfuse-ingestion-version"], "4");
});

test("送り先が無ければ、送らず、リポジトリにも書かない", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");

  const { sent, deps } = capturing();
  const result = await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), {}, deps);

  assert.equal(result.sent, 0);
  assert.equal(sent.length, 0);
  assert.equal(existsSync(join(root, "kit", "telemetry")), false);
  // **黙らない。** 設定されていないことを言う。
  assert.ok(result.note.includes("AUTODRIVE_OTLP_ENDPOINT"), `理由を言っていない: ${result.note}`);
});

// **モデル識別子は必須属性のままである**（定義§6）。トークンを送らない構成でも、
// §6の他の記録が持つ `model` はここが出どころなので、止めてはいけない。
test("送り先が無くても、モデル識別子は残す", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");

  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), {}, capturing().deps);
  assert.equal(readSessionState(root).last_model, "claude-opus-5");
});

test("同じ応答を二重に集計しない", async () => {
  const { root, transcript } = fixture([
    assistant("claude-opus-5", "r1", { output_tokens: 7 }),
    // 同一応答が複数行に分かれることがある
    assistant("claude-opus-5", "r1", { output_tokens: 7 }),
  ]);
  markWorkItem(root, "AUT-10", "kit");

  const { sent, deps } = capturing();
  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);

  const [opus] = spansOf(sent);
  assert.equal(opus["langfuse.observation.metadata.responses"], 1);
  assert.equal(JSON.parse(String(opus["langfuse.observation.usage_details"])).output, 7);
});

test("2回目の送信では、追記された分だけを送る", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");
  const { sent, deps } = capturing();
  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);

  writeFileSync(
    transcript,
    `${readFileSync(transcript, "utf8")}${assistant("claude-opus-5", "r2", { output_tokens: 3 })}\n`,
    "utf8",
  );
  const second = await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);
  assert.equal(second.sent, 1);
  assert.equal(JSON.parse(String(spansOf(sent.slice(1))[0]["langfuse.observation.usage_details"])).output, 3);
});

// **送れなかった分を捨てない。** カーソルを進めてしまうと、その分は二度と読めない。
test("送れなければカーソルを進めず、次に送り直す", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");

  const failing = capturing({ ok: false });
  const first = await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, failing.deps);
  assert.equal(first.sent, 0);
  assert.ok(first.note.includes("送り直す"), `送り直すことを言っていない: ${first.note}`);

  const ok = capturing();
  const second = await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, ok.deps);
  assert.equal(second.sent, 1, "送れなかった分が消えている");
  assert.equal(JSON.parse(String(spansOf(ok.sent)[0]["langfuse.observation.usage_details"])).output, 7);
});

test("新しい使用量が無ければ送らない", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");
  const { deps } = capturing();
  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);
  const again = await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);
  assert.equal(again.sent, 0);
});

// 定義§6は、どの作業単位にも属さないやり取りを認める一方、記録を捨てないことを
// 求める。**帰属できなかった理由ごと送る。** 送らないと、壊れた記録と見分けられない。
test("作業単位が解決できなくても、理由を添えて送る", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  const { sent, deps } = capturing();
  const result = await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);
  assert.equal(result.sent, 1);

  const [span] = spansOf(sent);
  assert.equal(span["langfuse.observation.metadata.work_item_id"], "");
  assert.ok(String(span["langfuse.observation.metadata.unattributed_reason"]).includes("マーカーが無い"));
});

test("マーカーが壊れている場合と、無い場合を見分ける", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  mkdirSync(join(root, ".autodrive"), { recursive: true });
  writeFileSync(join(root, ".autodrive", "current-work-item.json"), "{ これは JSON ではない", "utf8");

  const { sent, deps } = capturing();
  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);

  const reason = String(spansOf(sent)[0]["langfuse.observation.metadata.unattributed_reason"]);
  assert.ok(reason.includes("読めない"), `壊れていることを言っていない: ${reason}`);
  assert.ok(!reason.includes("マーカーが無い"), `無い場合と同じ言葉になっている: ${reason}`);
});

test("マーカーの内容が欠けている場合も、無い場合と見分ける", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  mkdirSync(join(root, ".autodrive"), { recursive: true });
  writeFileSync(
    join(root, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-1", repo: "" }),
    "utf8",
  );

  const { sent, deps } = capturing();
  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);

  const reason = String(spansOf(sent)[0]["langfuse.observation.metadata.unattributed_reason"]);
  assert.ok(reason.includes("欠けている"), `欠落を言っていない: ${reason}`);
  assert.ok(reason.includes("repo"), `どれが欠けたかを言っていない: ${reason}`);
});

test("壊れた行があっても他の行の集計を止めない", async () => {
  const { root, transcript } = fixture([
    assistant("claude-opus-5", "r1", { output_tokens: 7 }),
    "{ これは JSON ではない",
    assistant("claude-opus-5", "r2", { output_tokens: 3 }),
  ]);
  markWorkItem(root, "AUT-10", "kit");

  const { sent, deps } = capturing();
  await record({ transcript_path: transcript, session_id: "s1" }, root, new Date(), CONFIGURED, deps);
  assert.equal(JSON.parse(String(spansOf(sent)[0]["langfuse.observation.usage_details"])).output, 10);
});

test("セッション記録が読めなくても落ちない", async () => {
  const root = tempDir("autodrive-");
  const result = await record(
    { transcript_path: join(root, "無い.jsonl"), session_id: "s1" },
    root,
    new Date(),
    CONFIGURED,
    capturing().deps,
  );
  assert.equal(result.sent, 0);
});

test("必要な入力が欠けていれば何もしない", async () => {
  const root = tempDir("autodrive-");
  const result = await record({}, root, new Date(), CONFIGURED, capturing().deps);
  assert.equal(result.sent, 0);
  assert.equal(existsSync(join(root, "telemetry")), false);
});

test("セッション識別子はパスに使えない文字を含んでいても安全に扱う", async () => {
  const { root, transcript } = fixture([assistant("claude-opus-5", "r1", { output_tokens: 7 })]);
  markWorkItem(root, "AUT-10", "kit");
  await record({ transcript_path: transcript, session_id: "../../逃走" }, root, new Date(), CONFIGURED, capturing().deps);
  assert.equal(existsSync(join(root, ".autodrive", "cursors")), true);
});
