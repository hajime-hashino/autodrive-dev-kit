/**
 * Tracker アダプタ（Linear）。
 *
 * **このファイルは、実際に出た誤りのあとに置かれた。** アダプタにはテストが1件も
 * 無く、状態の解決が「型が一致した最初の1件」で書かれていた。連携を有効にした
 * ことで `started` 型が2つになった直後、着手が In Review を引き当てている
 * （AUT-165）。**それまで1つしか無かったため、誤りが表に出なかった。**
 */

import assert from "node:assert/strict";
import test from "node:test";

import { LinearTracker, repoFrom } from "../src/vendored/internal/adapters/trackerLinear.js";

/** 実装側の応答を差し込む。**要求ごとに何を返すかを、呼び出し側が決める。** */
function stubFetch(handler) {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    return { ok: true, status: 200, async json() { return { data: handler(body) }; } };
  };
  return {
    sent,
    restore() { globalThis.fetch = original; },
  };
}

const ISSUE = {
  id: "x",
  identifier: "AUT-1",
  title: "題",
  url: "",
  state: { type: "started" },
  labels: { nodes: [] },
};

/** チーム・状態・更新の3つに答える実装側。 */
function respondWith(states) {
  return (body) => {
    if (body.query.includes("teams {")) return { teams: { nodes: [{ id: "t", key: "AUT" }] } };
    if (body.query.includes("states {")) return { team: { states: { nodes: states } } };
    return { issueUpdate: { issue: ISSUE } };
  };
}

test("同じ型の状態が複数あれば、並びの先頭を採る", async () => {
  // **型は種別であって、状態そのものではない。** 実装側は同じ型の状態をいくつでも
  // 置ける。応答の順に頼ると、どれを引くかが決まらない。
  const stub = stubFetch(
    respondWith([
      { id: "review", type: "started", position: 1002 },
      { id: "progress", type: "started", position: 2 },
      { id: "done", type: "completed", position: 3 },
    ]),
  );
  try {
    await new LinearTracker("t", "AUT").advance("x", "started");
  } finally {
    stub.restore();
  }

  const update = stub.sent.find((b) => b.query.includes("issueUpdate"));
  assert.equal(update.variables.s, "progress", "並びの後ろにある状態を引いている");
});

test("応答の順が変わっても、同じ状態を引く", async () => {
  // **順序は保証されない。** 先頭に来たものを採る作りでは、実装側の都合で挙動が変わる。
  const stub = stubFetch(
    respondWith([
      { id: "progress", type: "started", position: 2 },
      { id: "review", type: "started", position: 1002 },
    ]),
  );
  try {
    await new LinearTracker("t", "AUT").advance("x", "started");
  } finally {
    stub.restore();
  }

  const update = stub.sent.find((b) => b.query.includes("issueUpdate"));
  assert.equal(update.variables.s, "progress");
});

test("対応する型の状態が無ければ、黙って別の状態へ進めない", async () => {
  const stub = stubFetch(respondWith([{ id: "progress", type: "started", position: 2 }]));
  try {
    await assert.rejects(
      () => new LinearTracker("t", "AUT").advance("x", "done"),
      /対応する状態が実装側に無い/,
    );
  } finally {
    stub.restore();
  }
});

test("ラベルから対象リポジトリを読む", () => {
  assert.equal(repoFrom(["repo:autodrive-dev-kit", "bug"]), "autodrive-dev-kit");
  assert.equal(repoFrom(["bug"]), null);
});

// --------------------------------------------------- 本文を直す（AUT-209）

// **書き換えるだけ。状態は見ない。** 着手前に限る規則は呼び出し側が持つ
// （`trackerCli.js`）。アダプタごとに同じ判断を置くと、実装が増えたときに
// 片方だけ緩くなる。
test("本文を書き換える要求を送る", async () => {
  const stub = stubFetch(() => ({ issueUpdate: { issue: { ...ISSUE, description: "直した本文" } } }));
  try {
    const view = await new LinearTracker("k", "AUT").revise("AUT-1", "直した本文");

    const sent = stub.sent[stub.sent.length - 1];
    assert.match(sent.query, /issueUpdate/);
    assert.match(sent.query, /description/);
    assert.equal(sent.variables.d, "直した本文", JSON.stringify(sent.variables));
    assert.equal(view.body, "直した本文");
  } finally {
    stub.restore();
  }
});

// **状態は触らない。** 本文だけを書き換える。
test("本文を直すとき、状態を触らない", async () => {
  const stub = stubFetch(() => ({ issueUpdate: { issue: ISSUE } }));
  try {
    await new LinearTracker("k", "AUT").revise("AUT-1", "x");

    const sent = stub.sent[stub.sent.length - 1];
    assert.equal(sent.query.includes("stateId"), false, sent.query);
  } finally {
    stub.restore();
  }
});
