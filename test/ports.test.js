import assert from "node:assert/strict";
import { KIT_VERSION } from "../src/vendored/internal/kitVersion.js";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { run as telemetryRun } from "../src/vendored/internal/telemetryCli.js";
import { run as trackerRun } from "../src/vendored/internal/trackerCli.js";
import { tempDir } from "./helpers/tmp.js";


function root() {
  return tempDir("autodrive-ports-");
}

function withWorkItem(id , repo) {
  const r = root();
  // **対象リポジトリを実際に置く。** これが無くても記録は書けていたが、それは
  // 無い場所をディレクトリごと作っていたからである（AUT-143）。実際には対象
  // リポジトリは必ず在るため、**在る前提で判定するのが現実に合う。**
  mkdirSync(join(r, repo), { recursive: true });
  mkdirSync(join(r, ".autodrive"), { recursive: true });
  writeFileSync(
    join(r, ".autodrive", "current-work-item.json"),
    JSON.stringify({ work_item_id: id, repo }),
    "utf8",
  );
  writeFileSync(
    join(r, ".autodrive", "session.json"),
    JSON.stringify({ session_id: "s1", last_model: "claude-opus-5", updated: "2026-08-22T00:00:00Z" }),
    "utf8",
  );
  return r;
}

function readEvents(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) );
}

// --------------------------------------------------------- Telemetry

test("停止を記録すると、必須属性がアダプタ側で付く", () => {
  const r = withWorkItem("AUT-12", "kit");
  const res = telemetryRun(
    ["停止を記録する", "--kind", "approval_required", "--type", "手戻り", "--detail", "承認を待つ", "--root", r],
    r,
  );
  assert.equal(res.code, 0);
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  assert.equal(event.type, "stop");
  assert.equal(event.stop_kind, "approval_required");
  // **種別と別に持つ。** 種別は「何について」、これは「減らす対象か」（定義§6 v0.11）。
  assert.equal(event.stop_type, "手戻り");
  assert.equal(event.work_item_id, "AUT-12");
  assert.equal(event.model, "claude-opus-5");
  // **固定の値と比べない。** バージョンはファイルから読むようになった。ここに literal を
  // 書くと、バージョンを上げるたびにテストを直すことになり、テストがバージョンの正しさを見なくなる。
  assert.equal(event.kit_version, KIT_VERSION);
  assert.notEqual(KIT_VERSION, "不明", "バージョンを読めていない");
  assert.equal(event.emitter, "adapter");
});

test("検出漏れは独立した操作を持たず、発見された工程で表す", () => {
  const r = withWorkItem("AUT-12", "kit");
  telemetryRun(
    ["修正を記録する", "--target", "verify", "--detail", "本番で判明", "--found-in", "本番", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  assert.equal(event.type, "miss");
  assert.equal(event.found_in, "本番");
});

test("発見された工程が無ければ手戻りとして記録し、原因を持たせる", () => {
  const r = withWorkItem("AUT-12", "kit");
  telemetryRun(
    ["修正を記録する", "--target", "src", "--detail", "直した", "--cause", "設計のズレ", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  assert.equal(event.type, "rework");
  assert.equal(event.cause, "設計のズレ");
});

test("定義に無い原因は受け付けない", () => {
  const r = withWorkItem("AUT-12", "kit");
  const res = telemetryRun(
    ["修正を記録する", "--target", "x", "--detail", "y", "--cause", "なんとなく", "--root", r],
    r,
  );
  assert.equal(res.code, 2);
});

test("境界変更を記録する", () => {
  const r = withWorkItem("AUT-12", "kit");
  telemetryRun(
    ["境界変更を記録する", "--area", "UI実装", "--from", "観察中", "--to", "委譲済み",
     "--detail", "12件で修正なし", "--basis", "観察中12件", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  assert.equal(event.type, "boundary_change");
  assert.equal(event.from, "観察中");
  assert.equal(event.basis, "観察中12件");
});

test("作業単位に紐づかない記録は残すが、成功として返さない", () => {
  const r = root();
  const res = telemetryRun(["停止を記録する", "--kind", "k", "--type", "入力", "--detail", "d", "--root", r], r);
  assert.equal(res.code, 1);
  const [event] = readEvents(join(r, "telemetry", "unattributed.jsonl"));
  assert.equal(event.work_item_id, null);
});

test("必須の引数が無ければ実行しない", () => {
  const r = withWorkItem("AUT-12", "kit");
  assert.equal(telemetryRun(["停止を記録する", "--type", "入力", "--detail", "d", "--root", r], r).code, 2);
  assert.equal(telemetryRun(["停止を記録する", "--kind", "k", "--type", "入力", "--root", r], r).code, 2);

  // **省略できる形にしない。** 既定値を置くと、考えずに通る側へ倒れる。
  // 定義§6は記録の時点で区別することを求めている。
  assert.equal(telemetryRun(["停止を記録する", "--kind", "k", "--detail", "d", "--root", r], r).code, 2);
  assert.equal(
    telemetryRun(["停止を記録する", "--kind", "k", "--type", "その他", "--detail", "d", "--root", r], r).code,
    2,
  );
});

// --------------------------------------------------------- Tracker

function fakeTracker() {
  const advanced = [];
  const view = (id , state) => ({
    id, state, title: "題", url: `https://example.invalid/${id}`, body: "本文",
  });
  return {
    advanced,
    async get(id) {
      return view(id ?? "AUT-99", "todo");
    },
    async create(input) {
      return { ...view("AUT-100", "backlog"), title: input.title, body: input.body };
    },
    async advance(id , to) {
      advanced.push([id, to]);
      return view(id, to);
    },
    async note() {},
  };
}

test("着手すると、記録の紐づけ先が置かれる", async () => {
  const r = root();
  const t = fakeTracker();
  const res = await trackerRun(["状態を進める", "AUT-12", "--to", "started", "--repo", "kit"], r, t);
  assert.equal(res.code, 0);
  const marker = JSON.parse(readFileSync(join(r, ".autodrive", "current-work-item.json"), "utf8"));
  assert.deepEqual(marker, { work_item_id: "AUT-12", repo: "kit" });
});

test("着手には書き込み先が要る。決まらなければ進めない", async () => {
  const r = root();
  const res = await trackerRun(["状態を進める", "AUT-12", "--to", "started"], r, fakeTracker());
  assert.equal(res.code, 2);
  assert.equal(existsSync(join(r, ".autodrive", "current-work-item.json")), false);
});

test("完了すると紐づけ先を外す。別の作業単位の記録が紛れ込まないように", async () => {
  const r = root();
  const t = fakeTracker();
  await trackerRun(["状態を進める", "AUT-12", "--to", "started", "--repo", "kit"], r, t);
  await trackerRun(["状態を進める", "AUT-12", "--to", "done"], r, t);
  assert.equal(existsSync(join(r, ".autodrive", "current-work-item.json")), false);
});

test("別の作業単位を完了しても、いまの紐づけ先は外さない", async () => {
  const r = root();
  const t = fakeTracker();
  await trackerRun(["状態を進める", "AUT-12", "--to", "started", "--repo", "kit"], r, t);
  await trackerRun(["状態を進める", "AUT-11", "--to", "done"], r, t);
  assert.equal(existsSync(join(r, ".autodrive", "current-work-item.json")), true);
});

test("定義に無い状態へは進めない", async () => {
  const r = root();
  const res = await trackerRun(["状態を進める", "AUT-12", "--to", "レビュー中"], r, fakeTracker());
  assert.equal(res.code, 2);
});

test("起票には題と本文が要る", async () => {
  const r = root();
  assert.equal((await trackerRun(["作業単位を起票する", "--title", "t"], r, fakeTracker())).code, 2);
});

// --------------------------------------------------------- 抜き取り確認

test("抜き取り確認を記録する。見なかった範囲も残る", () => {
  const r = withWorkItem("AUT-23", "kit");
  const res = telemetryRun(
    ["抜き取り確認を記録する", "--area", "エージェント作成画面",
     "--looked", "アバター選択とプロンプト入力", "--not-looked", "共有設定と検索結果の並び",
     "--detail", "崩れなし", "--root", r],
    r,
  );
  assert.equal(res.code, 0);
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-23.jsonl"));
  assert.equal(event.type, "sampling");
  assert.equal(event.looked, "アバター選択とプロンプト入力");
  assert.equal(event.not_looked, "共有設定と検索結果の並び");
  assert.equal(event.fixed, false);
  assert.equal(event.emitter, "adapter");
});

test("修正が入らなかった回も記録される。緩和の判定に要るため", () => {
  const r = withWorkItem("AUT-23", "kit");
  telemetryRun(
    ["抜き取り確認を記録する", "--area", "A", "--looked", "x", "--not-looked", "y",
     "--detail", "問題なし", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-23.jsonl"));
  assert.equal(event.fixed, false);
});

test("修正が入った場合は fixed が立つ", () => {
  const r = withWorkItem("AUT-23", "kit");
  telemetryRun(
    ["抜き取り確認を記録する", "--area", "A", "--looked", "x", "--not-looked", "y",
     "--detail", "崩れを直した", "--fixed", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-23.jsonl"));
  assert.equal(event.fixed, true);
});

test("見なかった範囲を省略できない", () => {
  const r = withWorkItem("AUT-23", "kit");
  const res = telemetryRun(
    ["抜き取り確認を記録する", "--area", "A", "--looked", "x", "--detail", "d", "--root", r],
    r,
  );
  assert.equal(res.code, 2);
});

test("修正の有無は件数ではなく真偽で持つ。修正率を算出させない", () => {
  const r = withWorkItem("AUT-23", "kit");
  telemetryRun(
    ["抜き取り確認を記録する", "--area", "A", "--looked", "x", "--not-looked", "y",
     "--detail", "d", "--root", r],
    r,
  );
  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-23.jsonl"));
  assert.equal(typeof event.fixed, "boolean");
  assert.equal("fixed_count" in event, false);
});

// **分からなかったことを、そう書く。** null だけ残すと、壊れた記録と見分けが
// つかない。セッション最初のターンでは、まだセッションの記録が無い（AUT-107）。
test("model を特定できなければ、その理由を残す", () => {
  const r = withWorkItem("AUT-12", "kit");
  // **セッションの記録を消す。** これがセッション最初のターンの状態である。
  rmSync(join(r, ".autodrive", "session.json"));

  const res = telemetryRun(
    ["停止を記録する", "--kind", "test", "--type", "入力", "--detail", "初日", "--root", r],
    r,
  );
  assert.equal(res.code, 0);

  const [event] = readEvents(join(r, "kit", "telemetry", "AUT-12.jsonl"));
  // この土台にはセッションの記録が無い。
  assert.equal(event.model, null);
  assert.ok(
    typeof event.model_unavailable_reason === "string" &&
      event.model_unavailable_reason.trim() !== "",
    `理由が残っていない: ${JSON.stringify(event)}`,
  );
  // **書き込みは自動である。** 手書きに見せない。
  assert.equal(event.emitter, "adapter");
});

// --------------------------- 前の名前も当面は受け付ける（AUT-134）

// **既に配った先の呼び出しが黙って壊れると、記録が落ちる。**
// 記録は遡って付け直せないため、落ちた分は戻らない。
test("前の名前で呼んでも記録される", () => {
  for (const [old, args] of [
    ["修正を記録する", ["--target", "x", "--detail", "y", "--cause", "実装バグ"]],
    ["境界変更を記録する", ["--area", "UI", "--from", "観察中", "--to", "委譲済み", "--detail", "d"]],
  ]) {
    const r = withWorkItem("AUT-90", "kit");
    const res = telemetryRun([old, ...args, "--root", r], r);
    assert.equal(res.code, 0, `${old} が通らない`);
    assert.equal(readEvents(join(r, "kit", "telemetry", "AUT-90.jsonl")).length, 1, `${old} で記録されない`);
    // **黙って受け入れない。** 新しい名前を出さないと、2つの名前が生き続ける。
    assert.ok(res.output.includes("に変わった"), `${old} で新しい名前を案内していない`);
  }
});
