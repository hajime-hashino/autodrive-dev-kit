import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { init, mergeHook } from "../src/init.ts";
import { delegateFor } from "../src/cli.ts";

// **本物の参照実装を指す。** 雛形をファイルから読むようになったため、偽の場所では
// 動かない。ここで偽物を使うと、雛形の欠落を捕まえられない。
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "autodrive-init-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

const placementOf = (r: { placed: { path: string; placement: string }[] }, path: string) =>
  r.placed.find((p) => p.path === path)?.placement;

// ------------------------------------------------------------ 前提の確認

// **記録も判定も履歴の上で成り立っている。** 履歴が無い場所へ置いても動かない。
test("git のリポジトリでなければ、置かずに理由を出す", () => {
  const root = mkdtempSync(join(tmpdir(), "autodrive-nogit-"));
  const r = init(root, KIT);
  assert.equal(r.code, 1);
  assert.ok(r.message?.includes("git init"), r.message ?? "");
  assert.equal(r.placed.length, 0, "止まるべきところで置いている");
  assert.equal(existsSync(join(root, "boundaries.yaml")), false);
});

// ------------------------------------------------------------ 置くもの

test("土台を置く", () => {
  const root = project();
  const r = init(root, KIT);
  assert.equal(r.code, 0);
  assert.ok(existsSync(join(root, "autodrive", "invariants")), "道具を複製していない");
  assert.notEqual(r.version, null, "版を残していない");
  for (const p of [
    ".env.example",
    ".github/workflows/invariants.yml",
    "docs/autodrive.md",
    "boundaries.yaml",
    "docs/what-why.md",
    "CLAUDE.md",
  ]) {
    assert.ok(existsSync(join(root, p)), `${p} が置かれていない`);
  }
});

// **固有のものは生成しない**（BOOTSTRAP 段階5）。テスト・ADR・境界変更履歴は
// そのプロジェクトのものであり、雛形を置くと中身が無いまま残る。
test("固有のものは生成しない", () => {
  const root = project();
  init(root, KIT);
  for (const p of ["docs/adr", "docs/boundary-changes.md", "test"]) {
    assert.equal(existsSync(join(root, p)), false, `${p} を作ってしまっている`);
  }
});

test("人にしかできないことを最後に出す", () => {
  const r = init(project(), KIT);
  assert.ok(r.todo.some((t) => t.includes(".env")), r.todo.join(" / "));
  assert.ok(r.todo.some((t) => t.includes("AUTODRIVE_CI_TOKEN")), r.todo.join(" / "));
});

// ------------------------------------------------------------ 2回目

// **何度実行しても壊れないこと。** 途中で失敗したときにやり直せる必要がある。
test("管理下は上書きし、播種は触らない", () => {
  const root = project();
  init(root, KIT);

  writeFileSync(join(root, "boundaries.yaml"), "areas: [自分で書いた]", "utf8");
  writeFileSync(join(root, ".env.example"), "書き換えた", "utf8");

  const r = init(root, KIT);
  assert.equal(placementOf(r, "boundaries.yaml"), "skipped");
  assert.equal(readFileSync(join(root, "boundaries.yaml"), "utf8"), "areas: [自分で書いた]");

  assert.equal(placementOf(r, ".env.example"), "managed");
  assert.notEqual(readFileSync(join(root, ".env.example"), "utf8"), "書き換えた");
});

// **利用側の規約を上書きしない。** ただし繋がっていなければ、そう言う。
test("既にある CLAUDE.md を上書きせず、繋ぎ方を案内する", () => {
  const root = project();
  writeFileSync(join(root, "CLAUDE.md"), "# うちの決まり\n", "utf8");

  const r = init(root, KIT);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# うちの決まり\n");
  assert.equal(placementOf(r, "CLAUDE.md"), "skipped");
  assert.ok(r.todo.some((t) => t.includes("docs/autodrive.md")), r.todo.join(" / "));
});

test("既に繋がっていれば、案内を出さない", () => {
  const root = project();
  writeFileSync(join(root, "CLAUDE.md"), "進め方は docs/autodrive.md に従う\n", "utf8");
  const r = init(root, KIT);
  assert.equal(r.todo.some((t) => t.includes("次の1行")), false, r.todo.join(" / "));
});

// **前の版の残骸を残さない。** 混ざると、どの版で動いているのかが読めなくなる。
// 版を固定するという目的そのものが崩れる。
test("入れ替えると、前の版の残骸が消える", () => {
  const root = project();
  init(root, KIT);

  const stale = join(root, "autodrive", "src", "前の版にだけあったもの.ts");
  writeFileSync(stale, "export const x = 1;\n", "utf8");
  assert.ok(existsSync(stale));

  init(root, KIT);
  assert.equal(existsSync(stale), false, "前の版の残骸が残っている");
});

// ------------------------------------------------------------ 旧名からの移行

// **前の版が置いた CI 定義を、黙って消さない。** 判定は invariants に改名したが
// （AUT-83）、古い verify.yml が残ると同じ判定が二重に走る。手を入れられている
// 可能性があるため、消すのは人に任せ、残っている事実だけを出す。
test("前の版の CI 定義が残っていたら、消さずに知らせる", () => {
  const root = project();
  const stale = join(root, ".github", "workflows", "verify.yml");
  mkdirSync(dirname(stale), { recursive: true });
  writeFileSync(stale, "run: autodrive/verify --root . --scope self\n", "utf8");

  const r = init(root, KIT);
  assert.ok(existsSync(stale), "人の判断を経ずに消している");
  assert.ok(
    r.todo.some((t) => t.includes("verify.yml") && t.includes("削除")),
    r.todo.join(" / "),
  );
  assert.ok(existsSync(join(root, ".github", "workflows", "invariants.yml")), "新しい定義を置いていない");
});

// **人が書いた別の verify.yml を、消せとは言わない。** 同じ名前でも、こちらが
// 置いたものとは限らない。
test("こちらが置いたものでなければ、削除を促さない", () => {
  const root = project();
  const theirs = join(root, ".github", "workflows", "verify.yml");
  mkdirSync(dirname(theirs), { recursive: true });
  writeFileSync(theirs, "run: npm test\n", "utf8");

  const r = init(root, KIT);
  assert.equal(
    r.todo.some((t) => t.includes("verify.yml")),
    false,
    r.todo.join(" / "),
  );
});

// **既に配線されている CI が旧名を呼んでいる。** 入れ替えても動き続けること。
test("旧名の入口も複製され、動き続ける", () => {
  const root = project();
  init(root, KIT);
  for (const name of ["invariants", "verify"]) {
    assert.ok(existsSync(join(root, "autodrive", name)), `${name} を複製していない`);
  }
});

// ------------------------------------------------------------ 記録の仕掛け

// **既にある登録を壊さない。** 設定は利用側のものである。
test("他の仕掛けを消さずに足す", () => {
  const before = JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "自前の仕掛け" }] }] },
  });
  const { json, changed } = mergeHook(before, "autodrive/hooks/record-tokens");

  assert.equal(changed, true);
  assert.ok(json.includes("自前の仕掛け"), "既にあったものが消えている");
  assert.ok(json.includes("autodrive/hooks/record-tokens"));
});

test("同じ登録が既にあれば、二重に足さない", () => {
  const before = JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "autodrive/hooks/record-tokens" }] }] },
  });
  assert.equal(mergeHook(before, "autodrive/hooks/record-tokens").changed, false);
});

test("設定が無ければ作る", () => {
  const { json, changed } = mergeHook(null, "autodrive/hooks/record-tokens");
  assert.equal(changed, true);
  assert.ok(json.includes("record-tokens"));
});

// **読めない設定を捨てない。** 壊れているからといって上書きすると、
// 利用側の設定が失われる。
test("読めない設定を上書きしない", () => {
  const { json, changed } = mergeHook("{ これは JSON ではない", "autodrive/hooks/record-tokens");
  assert.equal(changed, false);
  assert.equal(json, "{ これは JSON ではない");
});

// ------------------------------------------------------------ 入口

// **PATH に入れて増えるものを1つにする。** 使う人が打つのは init だけ。
test("AIが使う道具は、入口の下にまとめる", () => {
  for (const c of ["begin", "tracker", "telemetry", "invariants"]) {
    assert.notEqual(delegateFor(c), null, `${c} を渡せていない`);
  }
  // **旧名も通ること。** 既に配線されている CI が呼んでいる（AUT-83）。
  assert.equal(delegateFor("verify"), delegateFor("invariants"));

  assert.equal(delegateFor("知らない操作"), null);
  assert.equal(delegateFor(undefined), null);
});
