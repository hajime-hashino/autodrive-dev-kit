/**
 * Tracker ポートの GitHub Issues アダプタ。
 *
 * **実装が足りない分を、この層が埋めている**（識別子と5つの状態）。埋め方が
 * 間違っていても呼び出し側からは見えないため、**ここで見るしかない。**
 *
 * 通信はしない。`fetch` を差し替えて、**送った要求と受けた応答の両方**を見る。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GithubIssuesTracker,
  idOf,
  numberOf,
  repoFrom,
  stateOf,
} from "../src/vendored/internal/adapters/trackerGithub.js";

/** 応答を並べて返す作り物。**送られた要求を記録する。** */
function serving(responses) {
  const sent = [];
  const fetchStub = async (url, init = {}) => {
    sent.push({
      url: String(url),
      method: init.method ?? "GET",
      body: init.body === undefined ? null : JSON.parse(init.body),
    });
    const next = responses.shift() ?? { ok: true, status: 200, payload: {} };
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.payload ?? {},
    };
  };
  return { sent, fetchStub };
}

/** `fetch` を差し替えて走らせる。**元に戻す。** */
async function withFetch(fetchStub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const issue = (over = {}) => ({
  number: 123,
  title: "題",
  html_url: "https://github.com/o/r/issues/123",
  body: "本文",
  state: "open",
  state_reason: null,
  labels: [],
  ...over,
});

const tracker = () => new GithubIssuesTracker("t", "o/r", "AIEP");

// ------------------------------------------------------------ 識別子

test("番号に接頭辞を付けて、作業単位IDにする", () => {
  assert.equal(idOf("AIEP", 123), "AIEP-123");
  assert.equal(numberOf("AIEP", "AIEP-123"), 123);
});

// **黙って数字だけを拾わない。** 別の対象の識別子が、番号さえ合えば通ってしまう。
// **通ると、関係の無い Issue を進めることになる。**
test("別の接頭辞の作業単位IDは、受け取らない", () => {
  assert.throws(() => numberOf("AIEP", "CAS-123"), /wrong shape/);
  assert.throws(() => numberOf("AIEP", "123"), /wrong shape/);
  assert.throws(() => numberOf("AIEP", "#123"), /wrong shape/);
  // **何を渡せばよいかまで言う。**
  assert.throws(() => numberOf("AIEP", "x"), /AIEP-<number>/);
});

// ------------------------------------------------------------ 状態の読み取り

test("開いている状態を、ラベルで見分ける", () => {
  assert.equal(stateOf(issue({ labels: [] })), "backlog");
  assert.equal(stateOf(issue({ labels: [{ name: "state:todo" }] })), "todo");
  assert.equal(stateOf(issue({ labels: [{ name: "state:started" }] })), "started");
});

// **閉じた理由を見る。** `not_planned` を done と読むと、やらないと決めたものが
// 完了として数えられる。
test("閉じた理由で、完了と取りやめを分ける", () => {
  assert.equal(stateOf(issue({ state: "closed", state_reason: "completed" })), "done");
  assert.equal(stateOf(issue({ state: "closed", state_reason: "not_planned" })), "canceled");
  // 理由が無い場合は完了として扱う（GitHub の既定）。
  assert.equal(stateOf(issue({ state: "closed", state_reason: null })), "done");
});

// **閉じていれば、ラベルより理由を採る。** 両方あるときに取り違えない。
test("閉じた Issue に着手中のラベルが残っていても、開いているとは読まない", () => {
  const raw = issue({ state: "closed", state_reason: "completed", labels: [{ name: "state:started" }] });
  assert.equal(stateOf(raw), "done");
});

// **知らないラベルを状態として読まない。**
test("知らない state: ラベルは backlog として読む", () => {
  assert.equal(stateOf(issue({ labels: [{ name: "state:xxx" }] })), "backlog");
});

test("対象リポジトリをラベルから読む", () => {
  assert.equal(repoFrom(["state:started", "repo:aiep-app"]), "aiep-app");
  assert.equal(repoFrom(["state:started"]), null);
});

// ------------------------------------------------------------ 読み出し

test("作業単位を取得すると、語彙の形で返る", async () => {
  const { sent, fetchStub } = serving([
    { payload: issue({ labels: [{ name: "state:started" }, { name: "repo:aiep-app" }] }) },
  ]);

  const view = await withFetch(fetchStub, () => tracker().get("AIEP-123"));

  assert.deepEqual(view, {
    id: "AIEP-123",
    title: "題",
    url: "https://github.com/o/r/issues/123",
    body: "本文",
    state: "started",
    repo: "aiep-app",
  });
  assert.match(sent[0].url, /repos\/o\/r\/issues\/123$/);
});

// **提出を作業単位として数えない。** Issues API は PR も返す。
test("一覧から、提出を落とす", async () => {
  const { fetchStub } = serving([
    { payload: [issue({ number: 1 }), { ...issue({ number: 2 }), pull_request: { url: "x" } }] },
  ]);

  const list = await withFetch(fetchStub, () => tracker().list());

  assert.deepEqual(
    list.map((v) => v.id),
    ["AIEP-1"],
    "提出が作業単位として数えられている",
  );
});

// **一覧を1ページで切らない**（AUT-254）。提出も同じページに数えられるため、
// 作業単位が100件に満たなくても、古いものが落ちうる。
test("一覧は、2ページ目以降も読む。ページの終わりは提出を落とす前の件数で決める", async () => {
  // 1ページ目は満杯だが、ほとんどが提出。落とした後の件数で見ると、ここで止まる。
  const first = Array.from({ length: 100 }, (_, i) =>
    i === 0 ? issue({ number: 500 }) : { ...issue({ number: 1000 + i }), pull_request: { url: "x" } },
  );
  const { sent, fetchStub } = serving([{ payload: first }, { payload: [issue({ number: 1 })] }]);

  const list = await withFetch(fetchStub, () => tracker().list());

  assert.deepEqual(list.map((v) => v.id), ["AIEP-500", "AIEP-1"]);
  assert.match(sent[1].url, /page=2/);
});

test("読み切れなければ、欠けた一覧を返さずに落ちる", async () => {
  const full = () => ({ payload: Array.from({ length: 100 }, (_, i) => issue({ number: i + 1 })) });
  const { fetchStub } = serving(Array.from({ length: 300 }, full));
  await assert.rejects(() => withFetch(fetchStub, () => tracker().list()), /A list with gaps is not returned/);
});

// ------------------------------------------------------------ 状態を進める

test("完了へ進めると、完了として閉じる", async () => {
  const { sent, fetchStub } = serving([
    { payload: issue({ labels: [{ name: "state:started" }] }) }, // ラベルの読み出し
    { payload: {} }, // ラベルの削除
    { payload: issue({ state: "closed", state_reason: "completed" }) }, // 閉じる
    { payload: issue({ state: "closed", state_reason: "completed" }) }, // 読み直し
  ]);

  const view = await withFetch(fetchStub, () => tracker().advance("AIEP-123", "done"));

  const closing = sent.find((s) => s.method === "PATCH");
  assert.deepEqual(closing?.body, { state: "closed", state_reason: "completed" });
  // **開いている側のラベルを落とす。** 残すと、閉じた Issue に着手中の印が付いたままになる。
  assert.ok(
    sent.some((s) => s.method === "DELETE" && s.url.includes("state%3Astarted")),
    `着手中のラベルを落としていない: ${JSON.stringify(sent.map((s) => [s.method, s.url]))}`,
  );
  assert.equal(view.state, "done");
});

test("取りやめへ進めると、やらないと決めた理由で閉じる", async () => {
  const { sent, fetchStub } = serving([
    { payload: issue() },
    { payload: issue({ state: "closed", state_reason: "not_planned" }) },
    { payload: issue({ state: "closed", state_reason: "not_planned" }) },
  ]);

  await withFetch(fetchStub, () => tracker().advance("AIEP-123", "canceled"));

  const closing = sent.find((s) => s.method === "PATCH");
  assert.equal(closing?.body.state_reason, "not_planned", "完了として閉じている");
});

// **締め直しの経路を残す。** 閉じたものへ着手できないと、戻せなくなる。
test("閉じた作業単位へ着手すると、開け直す", async () => {
  const { sent, fetchStub } = serving([
    { payload: issue({ state: "closed", state_reason: "completed" }) }, // 開け直し
    { payload: issue() }, // ラベルの読み出し
    { payload: {} }, // ラベルの追加
    { payload: issue({ labels: [{ name: "state:started" }] }) },
  ]);

  await withFetch(fetchStub, () => tracker().advance("AIEP-123", "started"));

  const reopen = sent.find((s) => s.method === "PATCH");
  assert.deepEqual(reopen?.body, { state: "open" }, "開け直していない");
});

// **ラベルを先に付ける。** 後にすると、状態だけ進んでラベルの無い作業単位が残る。
test("着手のとき、対象リポジトリを状態より先に記す", async () => {
  const { sent, fetchStub } = serving([
    { payload: issue() },
    { payload: {} },
    { payload: issue({ labels: [{ name: "repo:aiep-app" }] }) },
    { payload: issue() },
    { payload: {} },
    { payload: issue() },
  ]);

  await withFetch(fetchStub, () => tracker().advance("AIEP-123", "started", "aiep-app"));

  const added = sent.filter((s) => s.method === "POST" && s.url.endsWith("/labels"));
  const names = added.flatMap((s) => s.body.labels);
  assert.ok(names.includes("repo:aiep-app"), `対象リポジトリを記していない: ${names.join(", ")}`);
  assert.ok(
    names.indexOf("repo:aiep-app") < names.indexOf("state:started") ||
      !names.includes("state:started"),
    "状態を先に付けている",
  );
});

// **間違ったラベルは、ラベルが無いより悪い。** 付け替えられること。
test("対象リポジトリを付け替えると、古いものを消す", async () => {
  const { sent, fetchStub } = serving([
    { payload: issue({ labels: [{ name: "repo:old" }] }) },
    { payload: {} },
    { payload: {} },
    { payload: issue({ labels: [{ name: "repo:new" }] }) },
  ]);

  await withFetch(fetchStub, () => tracker().mark("AIEP-123", "new"));

  assert.ok(
    sent.some((s) => s.method === "DELETE" && s.url.includes("repo%3Aold")),
    "古いラベルを消していない",
  );
});

// ------------------------------------------------------------ 失敗の経路

// **権限不足と、対象が無いことを、同じ言葉で言わない。** やることが違う。
test("権限が足りなければ、資格情報を確かめよと言う", async () => {
  const { fetchStub } = serving([{ ok: false, status: 403, payload: { message: "Forbidden" } }]);

  await assert.rejects(
    withFetch(fetchStub, () => tracker().get("AIEP-123")),
    /Write access to issues/,
  );
});

test("対象が無ければ、無いと言う", async () => {
  const { fetchStub } = serving([{ ok: false, status: 404, payload: { message: "Not Found" } }]);

  await assert.rejects(
    withFetch(fetchStub, () => tracker().get("AIEP-999")),
    /the target does not exist, or there is no permission to read it/,
  );
});

// **本文が読めなくても、落ちたことは言う。**
test("応答が読めなくても、失敗として返す", async () => {
  const fetchStub = async () => ({
    ok: false,
    status: 500,
    json: async () => {
      throw new Error("読めない");
    },
  });

  await assert.rejects(withFetch(fetchStub, () => tracker().get("AIEP-123")), /HTTP 500/);
});

// --------------------------------------------------- 本文を直す（AUT-209）

// **書き換えるだけ。状態は見ない。** 着手前に限る規則は呼び出し側が持つ。
test("本文を書き換える要求を送る", async () => {
  const { sent, fetchStub } = serving([{ payload: issue({ body: "直した本文" }) }]);

  const view = await withFetch(fetchStub, () => tracker().revise("AIEP-123", "直した本文"));

  assert.equal(sent[0].method, "PATCH");
  assert.match(sent[0].url, /repos\/o\/r\/issues\/123$/);
  assert.deepEqual(sent[0].body, { body: "直した本文" }, JSON.stringify(sent[0].body));
  assert.equal(view.body, "直した本文");
});

// **状態は触らない。**
test("本文を直すとき、開閉を触らない", async () => {
  const { sent, fetchStub } = serving([{ payload: issue() }]);

  await withFetch(fetchStub, () => tracker().revise("AIEP-123", "x"));

  assert.equal(sent[0].body.state, undefined, JSON.stringify(sent[0].body));
  assert.equal(sent[0].body.state_reason, undefined);
});

// **別の接頭辞の作業単位IDは、ここでも受け取らない。**
test("別の接頭辞では、本文を直さない", async () => {
  const { sent, fetchStub } = serving([{ payload: issue() }]);

  await assert.rejects(
    withFetch(fetchStub, () => tracker().revise("CAS-123", "x")),
    /wrong shape/,
  );
  assert.deepEqual(sent, [], "要求を送っている");
});
