/**
 * 統合された作業単位を閉じる仕掛けの判定。
 *
 * **壊した実装に対して落ちることまで確かめてある。** 通ることの確認だけでは、
 * 何も見ていないテストと区別できない。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describe,
  finished,
  submissionsFrom,
  reconcile,
  unmarked,
  workItemOf,
} from "../src/reconcile.js";
import { repoFrom } from "../src/adapters/trackerLinear.js";

// --- 提出から作業単位を読む -------------------------------------------------

test("ブランチ名から作業単位を読む", () => {
  assert.equal(workItemOf({ branch: "aut-107", title: "何か" }), "AUT-107");
});

test("ブランチ名を変えていても、題から読む", () => {
  // `--branch` で名前を変えられる。ブランチだけを根拠にすると、名前を変えた作業単位が
  // **永遠に閉じない。**
  assert.equal(workItemOf({ branch: "fix-the-thing", title: "AUT-42 直す" }), "AUT-42");
});

test("どちらからも読めなければ null", () => {
  assert.equal(workItemOf({ branch: "main", title: "見出しだけ" }), null);
});

test("大文字に揃える", () => {
  assert.equal(workItemOf({ branch: "aut-9", title: "" }), "AUT-9");
});

// --- 応答の読み方 -----------------------------------------------------------

test("統合されたかどうかを持つ。統合されていないものも落とさない", () => {
  // **落とすと、まだ統合されていない作業単位に印を補えない。** 提出は、統合されて
  // いなくてもどのリポジトリの作業だったかを知っている。
  const res = {
    status: 200,
    body: [
      { merged_at: null, head: { ref: "aut-1" }, title: "閉じただけ" },
      { merged_at: "2026-08-30T00:00:00Z", head: { ref: "aut-2" }, title: "統合" },
    ],
  };
  assert.deepEqual(submissionsFrom(res), [
    { branch: "aut-1", title: "閉じただけ", merged: false },
    { branch: "aut-2", title: "統合", merged: true },
  ]);
});

test("読めなかった場合は、空ではなく null を返す", () => {
  // **空を返すと「統合された作業単位は無かった」と読める。** 読めなかったことが消える。
  assert.equal(submissionsFrom({ status: 403, body: { message: "だめ" } }), null);
  assert.equal(submissionsFrom({ status: 0, body: {} }), null);
  assert.deepEqual(submissionsFrom({ status: 200, body: [] }), []);
});

// --- 閉じる対象 -------------------------------------------------------------

const view = (id, state, repo = null) => ({
  id,
  state,
  repo,
  title: "題",
  url: "u",
  body: "",
});

test("着手中で、統合済みのものだけを閉じる", () => {
  const items = [
    view("AUT-1", "started"),
    view("AUT-2", "done"),
    view("AUT-3", "todo"),
    view("AUT-4", "started"),
  ];
  const got = finished(items, new Set(["AUT-1", "AUT-2", "AUT-3"]));
  assert.deepEqual(got.map((i) => i.id), ["AUT-1"]);
});

test("いま着手したばかりのものは閉じない", () => {
  // 前の提出のブランチを使い回すと、着手直後に統合済みと判定されうる。
  const items = [view("AUT-1", "started")];
  assert.deepEqual(finished(items, new Set(["AUT-1"]), "AUT-1"), []);
});

// --- 印の補い -------------------------------------------------------------

test("印の無い着手中のものだけを補う", () => {
  const items = [
    view("AUT-1", "started"),
    view("AUT-2", "started", "agent-playground"),
    view("AUT-3", "done"),
  ];
  const repoOf = new Map([
    ["AUT-1", "autodrive-dev-kit"],
    ["AUT-2", "autodrive-dev-kit"],
    ["AUT-3", "autodrive-dev-kit"],
  ]);
  assert.deepEqual(
    unmarked(items, repoOf).map((u) => `${u.item.id}:${u.repo}`),
    ["AUT-1:autodrive-dev-kit"],
  );
});

// --- 印の読み取り ---------------------------------------------------------

test("印から対象リポジトリを読む", () => {
  assert.equal(repoFrom(["急ぎ", "repo:autodrive-dev-kit"]), "autodrive-dev-kit");
  assert.equal(repoFrom(["急ぎ"]), null);
  assert.equal(repoFrom([]), null);
});

// --- 全体 -------------------------------------------------------------------

function fakeTracker(items) {
  const advanced = [];
  const marked = [];
  return {
    advanced,
    marked,
    async list() { return items; },
    async advance(id, to, repo) { advanced.push(`${id}:${to}:${repo}`); },
    async mark(id, repo) { marked.push(`${id}:${repo}`); },
  };
}

function fakeApi(byslug) {
  return {
    available: true,
    async submissionsIn(slug) {
      return byslug[slug] ?? { status: 404, body: {} };
    },
  };
}

test("統合済みの作業単位を閉じ、印を補う", async () => {
  const tracker = fakeTracker([
    view("AUT-1", "started"),
    view("AUT-2", "started"),
    view("AUT-3", "started"),
  ]);
  const api = fakeApi({
    "me/kit": {
      status: 200,
      body: [
        { merged_at: "2026-08-30", head: { ref: "aut-1" }, title: "AUT-1" },
        { merged_at: null, head: { ref: "aut-2" }, title: "AUT-2" },
      ],
    },
  });

  const got = await reconcile({
    repos: [{ name: "kit", slug: "me/kit" }],
    tracker,
    api,
  });

  assert.deepEqual(got.closed, ["AUT-1"]);
  assert.deepEqual(tracker.advanced, ["AUT-1:done:kit"]);
  // AUT-2 は統合されていないが着手中で印が無いため、印だけ補う。
  assert.deepEqual(tracker.marked, ["AUT-2:kit"]);
  // AUT-3 は提出が1件も無いため、どちらも起きない。
  assert.deepEqual(got.marked, ["AUT-2 → kit"]);
});

test("閉じたものに、印を二重に付けない", async () => {
  const tracker = fakeTracker([view("AUT-1", "started")]);
  await reconcile({
    repos: [{ name: "kit", slug: "me/kit" }],
    tracker,
    api: fakeApi({
      "me/kit": { status: 200, body: [{ merged_at: "x", head: { ref: "aut-1" }, title: "" }] },
    }),
  });
  assert.deepEqual(tracker.marked, []);
});

test("閉じるときも対象リポジトリを渡す", async () => {
  // **印の無いまま閉じると、履歴として引けない。**
  const tracker = fakeTracker([view("AUT-1", "started")]);
  await reconcile({
    repos: [{ name: "kit", slug: "me/kit" }],
    tracker,
    api: fakeApi({
      "me/kit": { status: 200, body: [{ merged_at: "x", head: { ref: "aut-1" }, title: "" }] },
    }),
  });
  assert.deepEqual(tracker.advanced, ["AUT-1:done:kit"]);
});

test("資格情報が無ければ、黙って空を返さない", async () => {
  const tracker = fakeTracker([view("AUT-1", "started")]);
  const got = await reconcile({
    repos: [{ name: "kit", slug: "me/kit" }],
    tracker,
    api: { available: false, async submissionsIn() { throw new Error("呼ばれてはいけない"); } },
  });
  assert.deepEqual(got.closed, []);
  assert.equal(got.unreadable.length, 1);
  assert.deepEqual(tracker.advanced, []);
});

test("読めなかったリポジトリを残す", async () => {
  const tracker = fakeTracker([view("AUT-1", "started")]);
  const got = await reconcile({
    repos: [
      { name: "kit", slug: "me/kit" },
      { name: "closed", slug: "me/closed" },
      { name: "remoteless", slug: null },
    ],
    tracker,
    api: fakeApi({
      "me/kit": { status: 200, body: [{ merged_at: "x", head: { ref: "aut-1" }, title: "" }] },
    }),
  });
  assert.deepEqual(got.closed, ["AUT-1"]);
  assert.equal(got.unreadable.length, 2);
  assert.ok(got.unreadable.some((u) => u.includes("closed")));
  assert.ok(got.unreadable.some((u) => u.includes("remoteless")));
});

test("読めなかったことは、見出しごと出力に出る", () => {
  // **黙ると「片付いている」と読める。** 中身だけ出して見出しが無いと、閉じた一覧の
  // 続きに見えてしまい、**読めなかったものが閉じたものとして読まれる。**
  const text = describe({ closed: ["AUT-1"], marked: [], unreadable: ["kit: 提出を読めない"] })
    .join("\n");
  assert.ok(text.includes("統合を確かめられなかった"), "見出しが無い");
  assert.ok(text.includes("kit: 提出を読めない"), "中身が無い");
});

test("何も起きなければ、何も出さない", () => {
  assert.deepEqual(describe({ closed: [], marked: [], unreadable: [] }), []);
});
