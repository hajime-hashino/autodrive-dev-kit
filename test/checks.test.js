import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS, observeStops } from "../src/checks.js";


import { ACTIVE, NOT_IN_SCOPE, SUBSTITUTED, UNSUBSTITUTED } from "../src/state.js";
import { tempDir } from "./helpers/tmp.js";


function check(key) {
  const found = CHECKS.find((c) => c.key === key);
  assert.ok(found, `判定が登録されていない: ${key}`);
  return found;
}

/** 既定ブランチが提出だけで作られている履歴。根 + マージコミット。 */
const CLEAN_LOG = [
  "bbbbbbb\taaaaaaa ccccccc\tMerge pull request #1",
  "aaaaaaa\t\t初期化",
].join("\n");

function fakeRepo(
  name ,
  slug = `owner/${name}`,
  log = CLEAN_LOG,
) {
  return {
    name,
    path: `/tmp/${name}`,
    remoteSlug: () => slug,
    boundariesFile: () => null,
    boundaryHistoryFile: () => null,
    telemetryFiles: () => [],
    git: (...args) => {
      if (args[0] === "symbolic-ref") return "origin/main\n";
      if (args[0] === "log") return log;
      return null;
    },
    read: () => "",
  };
}

/** 記録を自動で残す仕掛けが登録されているリポジトリ。有効の条件のひとつ。 */
function repoWithHook(name) {
  const path = tempDir("autodrive-repo-");
  mkdirSync(join(path, ".claude"), { recursive: true });
  writeFileSync(
    join(path, ".claude", "settings.json"),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "k/hooks/record-tokens" }] }] } }),
    "utf8",
  );
  return { ...fakeRepo(name), path };
}

function fakeApi(responder , available = true, extra = {}) {
  return {
    available,
    rulesets: async (slug) => responder(slug),
    submissionsFor: async () => ({ status: 200, body: [] }),
    // 既定は「提出はあるが、統合されたものは無い」。取り残しの観測は出ない。
    submissionsIn: async () => ({ status: 200, body: [] }),
    ...extra,
  };
}

function event(over = {}) {
  return {
    source: "repo/telemetry/AUT-1.jsonl",
    work_item_id: "AUT-1",
    model: "claude-opus-5",
    kit_version: "bootstrap",
    emitter: "adapter",
    ...over,
  };
}

/** 記録が指す作業単位はすべて実在する、という前提の Tracker。 */
function fakeTrackerFor(events = []) {
  const ids = [...new Set(events.map((e) => e.work_item_id).filter((v) => typeof v === "string"))];
  const items = (ids.length > 0 ? ids : ["AUT-1"]).map(
    (id) => ({ id, title: "題", url: "", body: "", state: "started" }) ,
  );
  return {
    async get() { return items[0] ?? null; },
    async list() { return items; },
    async create() { return items[0]; },
    async advance() { return items[0]; },
    async note() {},
  };
}

function input(over = {}) {
  return {
    repos: [fakeRepo("r")],
    events: [],
    broken: [],
    api: fakeApi(() => ({ status: 200, body: [] })),
    tracker: fakeTrackerFor(over.events ?? []),
    scope: "cross",
    ...over,
  };
}

// --------------------------------------------------------- テレメトリ

test("記録が1件も無ければ失敗", async () => {
  const r = await check("telemetry_recorded").run(input());
  assert.equal(r.state, UNSUBSTITUTED);
});

test("読めない行があれば失敗", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event()], broken: ["repo/x.jsonl:3 JSON として読めない"] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
});

test("必須属性が欠けていれば失敗する。遡って付与できないため代替では埋まらない", async () => {
  const missing = { ...event() };
  delete missing.model;
  const r = await check("telemetry_recorded").run(
    input({ events: [missing ] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("model")));
});

test("emitter に未定義の値があれば失敗", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [event({ emitter: "human" })] }));
  assert.equal(r.state, UNSUBSTITUTED);
});

test("直書きがあり代替の記録もあれば、代替", async () => {
  const events = [
    event({ emitter: "manual" }),
    event({
      emitter: "manual",
      type: "substitution",
      invariant: "telemetry_recorded",
      detail: "アダプタが無いため直書きしている",
    }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.deepEqual(r.substitutions, ["アダプタが無いため直書きしている"]);
});

test("直書きがあるのに代替の記録が無ければ失敗", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [event({ emitter: "manual" })] }));
  assert.equal(r.state, UNSUBSTITUTED);
});

test("記録が存在しない作業単位を指していれば失敗する", async () => {
  const events = [event({ work_item_id: "AUT-999" })];
  const tracker = fakeTrackerFor([{ work_item_id: "AUT-1" }]);
  const r = await check("telemetry_recorded").run(input({ events, tracker }));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("AUT-999")));
});

test("記録の無い完了済み作業単位は観測として出すが、失敗にはしない", async () => {
  const events = [event()];
  const tracker = {
    async get() { return null; },
    async list() {
      return [
        { id: "AUT-1", title: "", url: "", body: "", state: "started" },
        { id: "AUT-2", title: "", url: "", body: "", state: "done" },
      ];
    },
    async create() { throw new Error("未使用"); },
    async advance() { throw new Error("未使用"); },
    async note() {},
  };
  const r = await check("telemetry_recorded").run(
    input({ events, tracker, repos: [repoWithHook("r")] }),
  );
  assert.equal(r.state, ACTIVE);
  assert.ok(r.observations.some((o) => o.includes("AUT-2")));
});

/** 着手中の AUT-1 だけを持つ Tracker。 */
function trackerWith(items) {
  return {
    async get() { return null; },
    async list() { return items; },
    async create() { throw new Error("未使用"); },
    async advance() { throw new Error("未使用"); },
    async note() {},
  };
}

test("統合済みなのに着手中の作業単位を観測として出すが、失敗にはしない", async () => {
  // **完了させる仕組みはハーネスに無い**（ADR 0007）。連携が効いていないことに
  // 気づく手段がこれである。実際に4件が統合済みのまま数日開いていた（AUT-165）。
  const tracker = trackerWith([{ id: "AUT-1", title: "", url: "", body: "", state: "started" }]);
  const api = fakeApi(() => ({ status: 200, body: [] }), true, {
    submissionsIn: async () => ({
      status: 200,
      body: [{ merged_at: "2026-09-06", head: { ref: "aut-1" }, title: "AUT-1 なにか" }],
    }),
  });

  const r = await check("telemetry_recorded").run(
    input({ events: [event()], tracker, api, repos: [repoWithHook("r")] }),
  );

  // **不変条件は定義§9のもの。Tracker 側の設定はその範囲外にある。**
  assert.equal(r.state, ACTIVE);
  assert.ok(
    r.observations.some((o) => o.includes("統合済みなのに着手中") && o.includes("AUT-1")),
    r.observations.join("\n"),
  );
});

test("統合されていない提出しか無ければ、取り残しとは言わない", async () => {
  const tracker = trackerWith([{ id: "AUT-1", title: "", url: "", body: "", state: "started" }]);
  const api = fakeApi(() => ({ status: 200, body: [] }), true, {
    submissionsIn: async () => ({
      status: 200,
      body: [{ merged_at: null, head: { ref: "aut-1" }, title: "AUT-1 なにか" }],
    }),
  });

  const r = await check("telemetry_recorded").run(
    input({ events: [event()], tracker, api, repos: [repoWithHook("r")] }),
  );

  assert.equal(r.state, ACTIVE);
  assert.ok(!r.observations.some((o) => o.includes("統合済みなのに着手中")), r.observations.join("\n"));
});

test("提出を読めなければ、読めなかったことを言う", async () => {
  // **黙ると「取り残しは無かった」と読める。**
  const tracker = trackerWith([{ id: "AUT-1", title: "", url: "", body: "", state: "started" }]);
  const api = fakeApi(() => ({ status: 200, body: [] }), true, {
    submissionsIn: async () => ({ status: 401, body: {} }),
  });

  const r = await check("telemetry_recorded").run(
    input({ events: [event()], tracker, api, repos: [repoWithHook("r")] }),
  );

  assert.ok(r.observations.some((o) => o.includes("提出を読めず")), r.observations.join("\n"));
});

test("完了済みの作業単位を指したままのマーカーを観測として出す", async () => {
  // **ここは連携では届かない。** マーカーは手元のファイルであり、Tracker が状態を
  // 動かしても残る。外れないまま記録が続くと、完了した作業単位に紐づく（AUT-165）。
  const repo = repoWithHook("r");
  mkdirSync(join(repo.path, ".autodrive"), { recursive: true });
  writeFileSync(
    join(repo.path, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-2", repo: "r" }),
    "utf8",
  );
  const tracker = trackerWith([
    { id: "AUT-1", title: "", url: "", body: "", state: "started" },
    { id: "AUT-2", title: "", url: "", body: "", state: "done" },
  ]);

  const r = await check("telemetry_recorded").run(
    input({ events: [event()], tracker, repos: [repo] }),
  );

  assert.equal(r.state, ACTIVE);
  assert.ok(
    r.observations.some((o) => o.includes("マーカーが完了済み") && o.includes("AUT-2")),
    r.observations.join("\n"),
  );
});

test("着手中の作業単位を指すマーカーは、何も言わない", async () => {
  const repo = repoWithHook("r");
  mkdirSync(join(repo.path, ".autodrive"), { recursive: true });
  writeFileSync(
    join(repo.path, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: "AUT-1", repo: "r" }),
    "utf8",
  );
  const tracker = trackerWith([{ id: "AUT-1", title: "", url: "", body: "", state: "started" }]);

  const r = await check("telemetry_recorded").run(
    input({ events: [event()], tracker, repos: [repo] }),
  );

  assert.ok(!r.observations.some((o) => o.includes("マーカーが完了済み")), r.observations.join("\n"));
});

test("Tracker の資格情報が無ければ判定不能として失敗する", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [event()], tracker: null }));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("判定できない状態")));
});

test("Tracker が読めなければ判定不能として失敗する", async () => {
  const tracker = fakeTrackerFor();
  tracker.list = async () => { throw new Error("接続できない"); };
  const r = await check("telemetry_recorded").run(input({ events: [event()], tracker }));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("接続できない")));
});

test("self では有効かどうかを判定しない。記録が壊れていないかだけを見る", async () => {
  const events = [event({ emitter: "manual" }), event()];
  const r = await check("telemetry_recorded").run(input({ events, scope: "self" }));
  assert.equal(r.state, NOT_IN_SCOPE);
  assert.equal(r.failing, false);
  assert.ok(r.observations.some((o) => o.includes("cross でのみ判定する")));
});

test("self でも壊れた記録は見落とさない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event({ work_item_id: null })], scope: "self" }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
});

test("self では直書きがあっても失敗しない。代替の記録を要求しない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event({ emitter: "manual" })], scope: "self" }),
  );
  assert.equal(r.failing, false);
});

// --------------------------------------------------------- 無効化の検出

test("トークンが無ければ判定不能として失敗する", async () => {
  const r = await check("ai_cannot_disable").run(
    input({ api: fakeApi(() => ({ status: 0, body: {} }), false) }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("判定できない状態")));
});

test("応答が読めない対象があれば失敗する。通してはいけない", async () => {
  const r = await check("ai_cannot_disable").run(
    input({ api: fakeApi(() => ({ status: 500, body: {} })) }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
});

test("origin が無いリポジトリは判定不能として失敗する", async () => {
  const r = await check("ai_cannot_disable").run(input({ repos: [fakeRepo("r", null)] }));
  assert.equal(r.state, UNSUBSTITUTED);
});

test("403 Upgrade はプラン制限として観測し、代替があれば代替", async () => {
  const events = [
    event({
      type: "substitution",
      invariant: "ai_cannot_disable",
      detail: "規約で担保している",
    }),
  ];
  const r = await check("ai_cannot_disable").run(
    input({
      events,
      api: fakeApi(() => ({ status: 403, body: { message: "Upgrade to GitHub Pro" } })),
    }),
  );
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("ruleset を設定できないプラン")));
});

test("403 でも Upgrade 以外は判定不能として扱う", async () => {
  const r = await check("ai_cannot_disable").run(
    input({ api: fakeApi(() => ({ status: 403, body: { message: "Forbidden" } })) }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
});

test("ruleset が0件なら保護されていないとして観測する", async () => {
  const events = [
    event({ type: "substitution", invariant: "ai_cannot_disable", detail: "—" }),
  ];
  const r = await check("ai_cannot_disable").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("ruleset が1件も無い")));
});

// --------------------------------------------------------- 有効境界

test("boundaries.yaml が無い状態を有効と報告しない", async () => {
  const events = [
    event({ type: "substitution", invariant: "boundary_change_logged", detail: "まだ無い" }),
  ];
  const r = await check("boundary_change_logged").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
});

test("boundaries.yaml があり履歴が無ければ、変更が残っていないとみなす", async () => {
  const repo = {
    ...fakeRepo("r"),
    boundariesFile: () => "/tmp/r/boundaries.yaml",
    boundaryHistoryFile: () => null,
    git: () => "abc1234567890\n",
    read: () => "",
  };
  const events = [
    event({ type: "substitution", invariant: "boundary_change_logged", detail: "—" }),
  ];
  const r = await check("boundary_change_logged").run(input({ repos: [repo], events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("委譲範囲の変更履歴が無い")));
});

test("全変更コミットが履歴から参照されていれば有効", async () => {
  const repo = {
    ...fakeRepo("r"),
    boundariesFile: () => "/tmp/r/boundaries.yaml",
    boundaryHistoryFile: () => "/tmp/r/boundary-changes.md",
    git: () => "abc1234567890\n",
    read: () => "## 2026-08-21 緩和\n- 設定変更: commit abc1234\n",
  };
  const r = await check("boundary_change_logged").run(input({ repos: [repo] }));
  assert.equal(r.state, ACTIVE);
});

test("履歴から参照されないコミットがあれば有効にしない", async () => {
  const repo = {
    ...fakeRepo("r"),
    boundariesFile: () => "/tmp/r/boundaries.yaml",
    boundaryHistoryFile: () => "/tmp/r/boundary-changes.md",
    git: () => "abc1234567890\ndef9876543210\n",
    read: () => "## 2026-08-21 緩和\n- 設定変更: commit abc1234\n",
  };
  const events = [
    event({ type: "substitution", invariant: "boundary_change_logged", detail: "—" }),
  ];
  const r = await check("boundary_change_logged").run(input({ repos: [repo], events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("def9876")));
});

// --------------------------------------------------------- 実行範囲

test("横断でしか成立しない不変条件は self の対象外", () => {
  assert.equal(check("outer_loop_running").scopes.has("self"), false);
  assert.equal(check("ai_cannot_disable").scopes.has("self"), false);
  assert.equal(check("boundary_change_logged").scopes.has("self"), true);
  assert.equal(check("telemetry_recorded").scopes.has("self"), true);
});

test("work_item_id が null の記録を通さない。属性の存在だけでは足りない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event({ work_item_id: null, type: "tokens" })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("work_item_id")));
});

test("必須属性が空文字の記録も通さない", async () => {
  const r = await check("telemetry_recorded").run(input({ events: [event({ model: "  " })] }));
  assert.equal(r.state, UNSUBSTITUTED);
});

// --------------------------------------------------- 帰属できなかった記録

/** 作業単位に紐づけられなかった記録。置き場と理由の両方を持つ。 */
function unattributed(over = {}) {
  return event({
    source: "repo/telemetry/unattributed.jsonl",
    work_item_id: null,
    type: "tokens",
    unattributed_reason: "作業単位マーカーが無い。起票せずに作業した可能性がある",
    ...over,
  });
}

// **起票せずに作業を始めることを妨げる仕掛けが無い以上、どの作業単位にも属さない
// やり取りは実在する。** 正しく動いた記録を、壊れた記録として失敗にしない。
test("帰属できなかった記録があっても有効できる", async () => {
  const events = [event(), unattributed()];
  const r = await check("telemetry_recorded").run(
    input({ events, repos: [repoWithHook("r")] }),
  );
  assert.equal(r.state, ACTIVE);
});

// **見えなくしない。** 件数は、起票せずに始めた作業の量を示す信号である。
test("帰属できなかった記録の件数と理由を出す", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [event(), unattributed(), unattributed()] }),
  );
  assert.ok(
    r.observations.some((o) => o.includes("帰属できなかった記録が 2 件")),
    `件数が出ていない: ${JSON.stringify(r.observations)}`,
  );
  assert.ok(r.observations.some((o) => o.includes("帰属できなかった理由")));
});

// 免除するのは work_item_id だけ。ランタイム由来の属性は帰属できなくても付く。
// **アダプタが書いたのに model が無いのは、壊れているのではなく「分からなかった」。**
// 値の出どころはセッションの記録であり、それを書くのはターンの終わりに走る仕掛け
// である。**セッション最初のターンにはまだ無い**（AUT-107）。
//
// 記録する側が守れない条件を、判定する側が要求してはいけない。遡って付与できない
// 以上、失敗にすると二度と消せない。
test("アダプタが書いた記録の model の欠けは、失敗にしない", async () => {
  const without = await check("telemetry_recorded").run(
    input({ events: [unattributed({ model: "", emitter: "adapter" })] }),
  );
  assert.equal(
    without.observations.some((o) => o.startsWith("必須属性が欠けている") && o.includes("model")),
    false,
    `失敗として扱っている: ${JSON.stringify(without.observations)}`,
  );

  // **model の有無で結論が変わらないこと。** この土台では別の理由で結論が
  // 決まるため、状態だけを見ても分からない。**同じ土台で比べる。**
  const with_ = await check("telemetry_recorded").run(
    input({ events: [unattributed({ model: "claude-opus-5", emitter: "adapter" })] }),
  );
  assert.equal(without.state, with_.state, "model の有無で結論が変わっている");
});

// **見えなくはしない。** 増えたなら、仕掛けが壊れている。
test("model を特定できなかった記録の件数を出す", async () => {
  const r = await check("telemetry_recorded").run(
    input({
      events: [
        unattributed({ model: "", emitter: "adapter", model_unavailable_reason: "最初のターン" }),
        unattributed({ model: "", emitter: "adapter", model_unavailable_reason: "最初のターン" }),
      ],
    }),
  );
  assert.ok(
    r.observations.some((o) => o.includes("model を特定できなかった記録が 2 件")),
    JSON.stringify(r.observations),
  );
  // **なぜ特定できなかったかまで出す。** 件数だけでは、直せるものか判断できない。
  assert.ok(r.observations.some((o) => o.includes("最初のターン")), JSON.stringify(r.observations));
});

// **手で書いた記録は別である。** アダプタを通っていないものまで免除すると、
// 直書きの抜け道になる。
test("手で書いた記録の model の欠けは、失敗のまま", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [unattributed({ model: "", emitter: "manual" })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(
    r.observations.some((o) => o.startsWith("必須属性が欠けている") && o.includes("model")),
    `欠落を言う観測が無い: ${JSON.stringify(r.observations)}`,
  );
});

// **model 以外は免除しない。** アダプタが書いたなら必ず付く。
test("アダプタが書いても、kit_version の欠けは失敗", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [unattributed({ kit_version: "", emitter: "adapter" })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(
    r.observations.some((o) => o.startsWith("必須属性が欠けている") && o.includes("kit_version")),
    JSON.stringify(r.observations),
  );
});

// --- 抜け道を塞ぐ ---

test("理由を名乗っても、置き場が違えば免除しない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [unattributed({ source: "repo/telemetry/AUT-1.jsonl" })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.startsWith("必須属性が欠けている") && o.includes("work_item_id")));
});

test("置き場が同じでも、理由が無ければ免除しない", async () => {
  const r = await check("telemetry_recorded").run(
    input({ events: [unattributed({ unattributed_reason: "  " })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.startsWith("必須属性が欠けている") && o.includes("work_item_id")));
});

test("有効境界より前の直書きは、判定の対象から外れる", async () => {
  const events = [
    event({ ts: "2026-01-01T00:00:00Z", emitter: "manual" }),
    event({ ts: "2026-02-01T00:00:00Z", type: "enactment", invariant: "telemetry_recorded" }),
    event({ ts: "2026-03-01T00:00:00Z" }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.ok(r.observations.some((o) => o.includes("有効境界")));
  assert.equal(r.observations.some((o) => o.includes("emitter=manual")), false);
});

test("有効境界より後の直書きは、判定の対象に入る", async () => {
  const events = [
    event({ ts: "2026-02-01T00:00:00Z", type: "enactment", invariant: "telemetry_recorded" }),
    event({ ts: "2026-03-01T00:00:00Z", emitter: "manual" }),
    event({
      ts: "2026-03-01T00:00:00Z",
      type: "substitution",
      invariant: "telemetry_recorded",
      detail: "アダプタが壊れている",
    }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.deepEqual(r.substitutions, ["アダプタが壊れている"]);
});

test("有効境界を動かした回数を隠さない", async () => {
  const mark = (ts) => event({ ts, type: "enactment", invariant: "telemetry_recorded" });
  const events = [mark("2026-02-01T00:00:00Z"), mark("2026-03-01T00:00:00Z"), event({ ts: "2026-04-01T00:00:00Z" })];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.ok(r.observations.some((o) => o.includes("2 回動いている")));
});

test("有効境界より前でも、必須属性の欠けは見逃さない", async () => {
  const events = [
    event({ ts: "2026-01-01T00:00:00Z", work_item_id: null }),
    event({ ts: "2026-02-01T00:00:00Z", type: "enactment", invariant: "telemetry_recorded" }),
    event({ ts: "2026-03-01T00:00:00Z" }),
  ];
  const r = await check("telemetry_recorded").run(input({ events }));
  assert.equal(r.state, UNSUBSTITUTED);
});

// --------------------------------------------------------- 有効かどうかの結論

test("委譲範囲の変更履歴にエントリがあっても、代替の記録があれば失敗しない", async () => {
  // 履歴が空でない経路。ここで代替の添付を忘れると UNSUBSTITUTED へ落ちる。
  const repo = {
    ...fakeRepo("r"),
    boundaryHistoryFile: () => "/tmp/r/boundary-changes.md",
    read: () => "## 2026-08-23 初期状態を置いた\n- 設定変更: commit abc1234\n",
  };
  const events = [
    event({ type: "substitution", invariant: "outer_loop_running", detail: "まだ一周していない" }),
  ];
  const r = await check("outer_loop_running").run(input({ repos: [repo], events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.equal(r.failing, false);
  assert.deepEqual(r.substitutions, ["まだ一周していない"]);
});

test("履歴が空の経路でも同じく代替が効く", async () => {
  const events = [
    event({ type: "substitution", invariant: "outer_loop_running", detail: "委譲範囲の表が無い" }),
  ];
  const r = await check("outer_loop_running").run(input({ events }));
  assert.equal(r.state, SUBSTITUTED);
  assert.equal(r.failing, false);
});

// ------------------------------------------- 提出を経ずに入った変更

const DIRECT_LOG = [
  "bbbbbbb\tp1\tAUT-42 ブランチを作らずに直接コミット",
  "aaaaaaa\t\t初期化",
].join("\n");

/** プラン制限で ruleset を持てない、いまの構成と同じ状況。 */
function planLimitedApi(submissions = { status: 200, body: [] }) {
  return {
    available: true,
    rulesets: async () => ({ status: 403, body: { message: "Upgrade to GitHub Pro" } }),
    submissionsFor: async () => submissions,
    repository: async () => ({ status: 200, body: { default_branch: "main" } }),
  };
}

// **保護設定を持てなくても、破られたかどうかは見られる。**
test("提出を経ずに既定ブランチへ入った変更があれば失敗する", async () => {
  const repos = [fakeRepo("r", "owner/r", DIRECT_LOG)];
  const r = await check("ai_cannot_disable").run(
    input({ repos, api: planLimitedApi(), events: [event({ type: "substitution", invariant: "ai_cannot_disable", detail: "—" })] }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(
    r.observations.some((o) => o.includes("提出を経ずに既定ブランチへ入っている") && o.includes("bbbbbbb")),
    `どのコミットかを出していない: ${JSON.stringify(r.observations)}`,
  );
});

// squash マージでは全コミットが非マージになる。コミットの形だけで決めない。
test("統合済みの提出に含まれていれば、直接コミットとしない", async () => {
  const repos = [fakeRepo("r", "owner/r", DIRECT_LOG)];
  const merged = { status: 200, body: [{ merged_at: "2026-08-24T00:00:00Z" }] };
  const r = await check("ai_cannot_disable").run(
    input({ repos, api: planLimitedApi(merged), events: [event({ type: "substitution", invariant: "ai_cannot_disable", detail: "—" })] }),
  );
  assert.equal(r.state, SUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("すべて提出を経て入っている")));
});

test("提出を読めなければ、直接コミットの有無を判定しない", async () => {
  const repos = [fakeRepo("r", "owner/r", DIRECT_LOG)];
  const r = await check("ai_cannot_disable").run(
    input({ repos, api: planLimitedApi({ status: 403, body: { message: "Resource not accessible" } }) }),
  );
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("提出を読めず")), JSON.stringify(r.observations));
});

test("既定ブランチの履歴を読めなければ判定しない", async () => {
  const repos = [fakeRepo("r", "owner/r", null)];
  const r = await check("ai_cannot_disable").run(input({ repos, api: planLimitedApi() }));
  assert.equal(r.state, UNSUBSTITUTED);
  assert.ok(r.observations.some((o) => o.includes("提出を経たかを確かめられない")), JSON.stringify(r.observations));
});

test("すべての判定が、有効でないときに代替の記録を読むこと", async () => {
  // 代替の記録が無ければ、どの判定も UNSUBSTITUTED になる。
  // 添付を忘れた経路があると、代替を置いても失敗したままになり、ここで露見する。
  const withSubstitutions = ["outer_loop_running", "boundary_change_logged", "ai_cannot_disable"];
  for (const key of withSubstitutions) {
    const events = [event({ type: "substitution", invariant: key, detail: "代替あり" })];
    const r = await check(key).run(input({ events }));
    assert.notEqual(r.state, UNSUBSTITUTED, `${key} が代替の記録を読んでいない`);
  }
});

// ---------------------------------------------------------------- 停止の内訳

// **判定はしない。数を見せる。** 定義§6（v0.11）は停止を2種類に分ける。
// 入力を得る停止は減らす対象ではないため、一括りに数えて減らしにかかると
// 必要な対話まで削られる。実際にその誤読が起きた（AUT-77）。
function stopped(...pairs) {
  return pairs.map(([stop_type, stop_kind], i) => ({
    type: "stop",
    stop_type,
    stop_kind,
    source: `t${i}`,
  }));
}

function observed(events) {
  const lines = [];
  observeStops({ observe: (l) => lines.push(l) }, events);
  return lines;
}

test("停止は2種類に分けて数える", () => {
  const lines = observed(
    stopped(["入力", "見え方の決定"], ["手戻り", "承認で差し戻し"], ["入力", "見え方の決定"]),
  );
  assert.ok(lines[0]?.includes("入力 2"), lines.join(" / "));
  assert.ok(lines[0]?.includes("手戻り 1"), lines.join(" / "));
});

// **繰り返し出ている種別が上に来る。** 定義§6の「繰り返し出る種別はスキル化・
// 自動化の候補」は、この並びから読む。
test("同じ種別が繰り返し出ていることが分かる", () => {
  // **先に出た順ではなく、多い順。** 挿入順と件数順をわざと食い違わせる。
  const lines = observed(
    stopped(["手戻り", "1回だけ"], ["入力", "多いほう"], ["入力", "多いほう"]),
  );
  const body = lines.slice(1);
  assert.ok(body[0]?.includes("多いほう") && body[0]?.includes("2 件"), body.join(" / "));
});

// **区別の無い記録を欠陥として扱わない。** 種類は後から足したものであり、
// 遡って分類すると解釈が入る（定義§6は遡及付与を禁じる）。
test("種類を持たない古い記録は「区別なし」として残す", () => {
  const lines = observed(stopped([undefined, "昔の記録"], ["入力", "いまの記録"]));
  assert.ok(lines[0]?.includes("区別なし 1"), lines.join(" / "));
  assert.ok(lines.some((l) => l.includes("区別なし / 昔の記録")), lines.join(" / "));
});

// 区別が要らないときに、要らない言葉を出さない。
test("すべてに種類が付いていれば、区別なしは出さない", () => {
  const lines = observed(stopped(["入力", "a"], ["手戻り", "b"]));
  assert.equal(lines[0]?.includes("区別なし"), false, lines[0]);
});

test("停止が1件も無ければ、何も言わない", () => {
  assert.deepEqual(observed([]), []);
  // 記録には停止以外も並ぶ。**それを停止として数えない。**
  const others = [{ type: "cost", source: "t" }];
  assert.deepEqual(observed(others), []);
});

test("停止以外の記録を数に混ぜない", () => {
  const events = [
    ...stopped(["入力", "見え方の決定"]),
    ...([{ type: "rework", cause: "要件のズレ", source: "t" }] ),
  ];
  assert.ok(observed(events)[0]?.startsWith("停止 1 件"), observed(events).join(" / "));
});
