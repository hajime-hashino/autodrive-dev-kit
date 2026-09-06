import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { init, mergeHook, vendor } from "../src/init.js";
import { delegateFor } from "../src/cli.js";
import { tempDir } from "./helpers/tmp.js";

// **本物の参照実装を指す。** 雛形をファイルから読むようになったため、偽の場所では
// 動かない。ここで偽物を使うと、雛形の欠落を捕まえられない。
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project() {
  const root = tempDir("autodrive-init-");
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

const placementOf = (r , path) =>
  r.placed.find((p) => p.path === path)?.placement;

// ------------------------------------------------------------ 前提の確認

// **記録も判定も履歴の上で成り立っている。** 履歴が無い場所へ置いても動かない。
test("git のリポジトリでなければ、置かずに理由を出す", () => {
  const root = tempDir("autodrive-nogit-");
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

// **AIにできることを、ここに書かない。** この一覧は Claude Code を開く前に
// 読まれるため、書いたものはすべて人の作業になる（AUT-100）。
test("人にしかできないことだけを出す", () => {
  const r = init(project(), KIT);
  const said = r.todo.join("\n");

  // AIに実行できないもの。
  assert.ok(said.includes(".env"), said);
  assert.ok(said.includes("Claude Code"), said);

  // **API を呼べば済むものを、人に振らない。**
  for (const ai of ["AUTODRIVE_CI_TOKEN を登録", "gh repo create", "置き場所を作り"]) {
    assert.equal(said.includes(ai), false, `AIにできることを人に振っている: ${ai}`);
  }
});

// ------------------------------------------------------------ 2回目

// **何度実行しても壊れないこと。** 途中で失敗したときにやり直せる必要がある。
test("管理下は上書きし、播種は触らない", () => {
  const root = project();
  init(root, KIT);

  writeFileSync(join(root, "boundaries.yaml"), "areas: [自分で書いた]", "utf8");

  const r = init(root, KIT);
  assert.equal(placementOf(r, "boundaries.yaml"), "skipped");
  assert.equal(readFileSync(join(root, "boundaries.yaml"), "utf8"), "areas: [自分で書いた]");

  assert.equal(placementOf(r, ".env.example"), "managed");
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

// ------------------------------ 入れ替えは、落ちても道具を消さない（AUT-131）

/** 複製の途中で必ず落ちる道具置き場を作る。**権限に頼らない**（root でも効く）。 */
function brokenKit() {
  const kit = tempDir("autodrive-brokenkit-");
  writeFileSync(join(kit, "VERSION"), "9.9.9\n", "utf8");
  mkdirSync(join(kit, "src"), { recursive: true });
  writeFileSync(join(kit, "src", "ok.js"), "//\n", "utf8");
  // 行き先の無いリンク。statSync が落ちる。
  symlinkSync(join(kit, "src", "無い"), join(kit, "src", "壊れたリンク"));
  return kit;
}

// **消してから置いていた。** 途中で落ちると、古い版も新しい版も無い状態が残った。
test("複製が途中で落ちても、古い道具が残る", () => {
  const root = project();
  init(root, KIT);
  const before = readdirSync(join(root, "autodrive")).sort();
  assert.ok(before.length > 0, "そもそも置かれていない");

  assert.throws(() => vendor(root, brokenKit()), "落ちていない。試験になっていない");

  assert.deepEqual(readdirSync(join(root, "autodrive")).sort(), before, "道具が消えた");
  assert.ok(existsSync(join(root, "autodrive", "bin", "autodrive-dev-kit")), "入口が消えた");
});

test("落ちたあと、作りかけを残さない", () => {
  const root = project();
  init(root, KIT);
  try { vendor(root, brokenKit()); } catch { /* 落ちる想定 */ }
  assert.equal(existsSync(join(root, "autodrive.new")), false, "作りかけが残っている");
  assert.equal(existsSync(join(root, "autodrive.old")), false, "古い版が残っている");
});

// **`copyFileSync` は中身しか写さない。** 権が落ちると打てなくなる。
test("実行権を写す", () => {
  const root = project();
  init(root, KIT);
  for (const f of ["bin/autodrive-dev-kit", "invariants", "hooks/record-tokens"]) {
    const p = join(root, "autodrive", ...f.split("/"));
    if (!existsSync(p)) continue;
    assert.ok(statSync(p).mode & 0o111, `${f} が実行できない`);
  }
});

// **再帰の複製に頼らない。** virtiofs の作業場で EACCES になる。
test("ディレクトリごとの再帰複製を使わない", () => {
  const src = readFileSync(join(KIT, "src", "init.js"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
  assert.equal(src.includes("cpSync"), false, "再帰複製に頼っている");
  assert.ok(src.includes("copyFileSync"), "1ファイルずつ写していない");
});

// ライセンスは、複製された先まで付いていくこと。
//
// **ここに置かれるのはこの道具のコードの複製である。** Apache-2.0 は「複製を
// 受け取る人にライセンスの写しを渡す」ことを求めている（§4(a)）。入れ忘れると、
// **採用先にライセンス文の無いコードの複製が残る。**
//
// 誰のものかも残す（§4(d)）。名前の無い複製にしない。
test("複製された道具に、ライセンスと著作権表示が付いてくる", () => {
  const root = project();
  init(root, KIT);

  const license = join(root, "autodrive", "LICENSE");
  assert.ok(existsSync(license), "**ライセンス文の無いコードの複製になっている**");
  const text = readFileSync(license, "utf8");
  assert.match(text, /Apache License/, "Apache-2.0 の全文が入っていない");
  assert.match(text, /Version 2\.0, January 2004/, "版が読み取れない");

  const notice = join(root, "autodrive", "NOTICE");
  assert.ok(existsSync(notice), "**誰のものか分からない複製になっている**");
  assert.match(readFileSync(notice, "utf8"), /Copyright \d{4}/, "著作権表示が無い");
});

// 元の道具の側にも、置かれていること。
//
// **複製にだけ入っていても意味が無い。** 受け取る経路は `init` だけではない。
// `npx github:` も `git clone` も、このリポジトリを直接読む。
test("参照実装そのものに、ライセンスと著作権表示がある", () => {
  for (const name of ["LICENSE", "NOTICE"]) {
    assert.ok(existsSync(join(KIT, name)), `${name} が無い`);
  }
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  // **文書とメタデータを食い違わせない。** 道具の一覧に出るのはこちらである。
  assert.equal(pkg.license, "Apache-2.0", "package.json の license が違う");
  assert.match(readFileSync(join(KIT, "NOTICE"), "utf8"), new RegExp(pkg.author ?? "^$"),
    "NOTICE と package.json の author が食い違っている");
});
