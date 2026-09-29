import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { init, mergeHook, vendor } from "../src/vendored/internal/init.js";
import { delegateFor } from "../src/vendored/internal/cli.js";
import { defaults } from "../src/vendored/internal/config.js";
import { tempDir } from "./helpers/tmp.js";

// **本物の参照実装を指す。** テンプレートをファイルから読むようになったため、偽の場所では
// 動かない。ここで偽物を使うと、テンプレートの欠落を捕まえられない。
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
  assert.ok(existsSync(join(root, "autodrive", "invariants")), "autodrive-dev-kit を複製していない");
  assert.notEqual(r.version, null, "バージョンを残していない");
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

// **固有のものは生成しない**（BOOTSTRAP 段階5）。テスト・ADR・委譲範囲の変更履歴は
// そのプロジェクトのものであり、テンプレートを置くと中身が無いまま残る。
test("固有のものは生成しない", () => {
  const root = project();
  init(root, KIT);
  for (const p of ["docs/boundary-changes.md", "test"]) {
    assert.equal(existsSync(join(root, p)), false, `${p} を作ってしまっている`);
  }
  // **ADR は索引だけ。** 判断そのものは、そのプロジェクトが書く。
  assert.deepEqual(readdirSync(join(root, "docs", "adr")), ["README.md"], "ADR そのものを作ってしまっている");
});

// **索引が無いと、どこへ書くのかも、着手のたびに読むことも伝わらない。** 配った先で
// ADR が1件も書かれていなかった（AUT-255）。
test("ADR の索引を置き、既にあれば触らない", () => {
  const root = project();
  const r = init(root, KIT);
  assert.equal(placementOf(r, "docs/adr/README.md"), "seeded");
  assert.ok(readFileSync(join(root, "docs", "adr", "README.md"), "utf8").includes("着手したら"));

  writeFileSync(join(root, "docs", "adr", "README.md"), "# うちの索引\n", "utf8");
  const again = init(root, KIT);
  assert.equal(placementOf(again, "docs/adr/README.md"), "skipped");
  assert.equal(readFileSync(join(root, "docs", "adr", "README.md"), "utf8"), "# うちの索引\n");

  // 規約から索引へ辿れる。**置き場所を知らないと、書かれない。**
  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");
  assert.ok(rules.includes("](adr/README.md)"), "規約から索引を指していない");
});

// **配った先に無いものを、番号だけで指さない。** 「ADR 0012」は、配った先では
// 自分のリポジトリにあるものと読める（AUT-255）。
test("配布物は、autodrive-dev-kit の ADR を番号だけで指さない", () => {
  const root = project();
  init(root, KIT);
  for (const p of ["docs/autodrive.md", "docs/autodrive-reference.md", "docs/quality.md"]) {
    const body = readFileSync(join(root, p), "utf8");
    for (const m of body.matchAll(/ADR \d{4}/g)) {
      const around = body.slice(Math.max(0, m.index - 30), m.index + 120);
      assert.ok(around.includes("autodrive-dev-kit/blob/main/docs/adr/"), `${p}: ${around}`);
    }
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

// **押す画面が無いものを頼まない**（AUT-249）。GitHub Issues は提出の本文で閉じる。
test("Tracker の連携は、設定する画面がある実装にだけ頼む", () => {
  const withTracker = (tracker, language = "ja") => {
    const config = defaults();
    config.language = language;
    config.ports.tracker = tracker;
    if (tracker === "github-issues") config.tracker.prefix = "AIEP";
    return init(project(), KIT, config).todo.join("\n");
  };

  const linear = withTracker("linear");
  assert.ok(linear.includes("linear と github を連携させ"), linear);

  for (const language of ["ja", "en"]) {
    const said = withTracker("github-issues", language);
    assert.equal(said.includes("github-issues"), false, `押す画面が無いものを頼んでいる: ${said}`);
    // 案内そのものは出ている。消えたのが連携の項目だけであることを確かめる。
    assert.ok(said.includes("Claude Code"), said);
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

// **前のバージョンの残骸を残さない。** 混ざると、どのバージョンで動いているのかが読めなくなる。
// バージョンを固定するという目的そのものが崩れる。
test("入れ替えると、前のバージョンの残骸が消える", () => {
  const root = project();
  init(root, KIT);

  const stale = join(root, "autodrive", "internal", "前のバージョンにだけあったもの.ts");
  writeFileSync(stale, "export const x = 1;\n", "utf8");
  assert.ok(existsSync(stale));

  init(root, KIT);
  assert.equal(existsSync(stale), false, "前のバージョンの残骸が残っている");
});

// ------------------------------------------------------------ 旧名からの移行

// **前のバージョンが置いた CI 定義を、黙って消さない。** 判定は invariants に改名したが
// （AUT-83）、古い verify.yml が残ると同じ判定が二重に走る。手を入れられている
// 可能性があるため、消すのは人に任せ、残っている事実だけを出す。
test("前のバージョンの CI 定義が残っていたら、消さずに知らせる", () => {
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
test("AIが使うコマンドは、入口の下にまとめる", () => {
  for (const c of ["begin", "tracker", "telemetry", "invariants"]) {
    assert.notEqual(delegateFor(c), null, `${c} を渡せていない`);
  }
  assert.equal(delegateFor("知らない操作"), null);
  assert.equal(delegateFor(undefined), null);
});

// ------------------------------ 入れ替えは、落ちても autodrive-dev-kit を消さない（AUT-131）

/** 複製の途中で必ず落ちる複製先を作る。**権限に頼らない**（root でも効く）。 */
function brokenKit() {
  const kit = tempDir("autodrive-brokenkit-");
  writeFileSync(join(kit, "VERSION"), "9.9.9\n", "utf8");
  // **複製の中身と同じ形にする。** 形が違うと、複製そのものではなく
  // 「複製元が無い」で落ち、試験になっていないことに気づけない。
  const inside = join(kit, "src", "vendored");
  mkdirSync(inside, { recursive: true });
  writeFileSync(join(inside, "ok.js"), "//\n", "utf8");
  // 行き先の無いリンク。statSync が落ちる。
  symlinkSync(join(inside, "無い"), join(inside, "壊れたリンク"));
  return kit;
}

// **消してから置いていた。** 途中で落ちると、古いバージョンも新しいバージョンも無い状態が残った。
test("複製が途中で落ちても、古い autodrive-dev-kit が残る", () => {
  const root = project();
  init(root, KIT);
  const before = readdirSync(join(root, "autodrive")).sort();
  assert.ok(before.length > 0, "そもそも置かれていない");

  assert.throws(() => vendor(root, brokenKit()), "落ちていない。試験になっていない");

  assert.deepEqual(readdirSync(join(root, "autodrive")).sort(), before, "autodrive-dev-kit が消えた");
  assert.ok(existsSync(join(root, "autodrive", "bin", "autodrive-dev-kit")), "入口が消えた");
});

test("落ちたあと、作りかけを残さない", () => {
  const root = project();
  init(root, KIT);
  try { vendor(root, brokenKit()); } catch { /* 落ちる想定 */ }
  assert.equal(existsSync(join(root, "autodrive.new")), false, "作りかけが残っている");
  assert.equal(existsSync(join(root, "autodrive.old")), false, "古いバージョンが残っている");
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

// **再帰の複製に頼らない。** virtiofs のサンドボックスで EACCES になる。
test("ディレクトリごとの再帰複製を使わない", () => {
  const src = readFileSync(join(KIT, "src", "vendored", "internal", "init.js"), "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");
  assert.equal(src.includes("cpSync"), false, "再帰複製に頼っている");
  assert.ok(src.includes("copyFileSync"), "1ファイルずつ写していない");
});

// ライセンスは、複製された先まで付いていくこと。
//
// **ここに置かれるのはこの autodrive-dev-kit のコードの複製である。** Apache-2.0 は「複製を
// 受け取る人にライセンスの写しを渡す」ことを求めている（§4(a)）。入れ忘れると、
// **採用先にライセンス文の無いコードの複製が残る。**
//
// 誰のものかも残す（§4(d)）。名前の無い複製にしない。
test("複製された autodrive-dev-kit に、ライセンスと著作権表示が付いてくる", () => {
  const root = project();
  init(root, KIT);

  const license = join(root, "autodrive", "LICENSE");
  assert.ok(existsSync(license), "**ライセンス文の無いコードの複製になっている**");
  const text = readFileSync(license, "utf8");
  assert.match(text, /Apache License/, "Apache-2.0 の全文が入っていない");
  assert.match(text, /Version 2\.0, January 2004/, "バージョンが読み取れない");

  const notice = join(root, "autodrive", "NOTICE");
  assert.ok(existsSync(notice), "**誰のものか分からない複製になっている**");
  assert.match(readFileSync(notice, "utf8"), /Copyright \d{4}/, "著作権表示が無い");
});

// 元の autodrive-dev-kit の側にも、置かれていること。
//
// **複製にだけ入っていても意味が無い。** 受け取る経路は `init` だけではない。
// `npx github:` も `git clone` も、このリポジトリを直接読む。
test("参照実装そのものに、ライセンスと著作権表示がある", () => {
  for (const name of ["LICENSE", "NOTICE"]) {
    assert.ok(existsSync(join(KIT, name)), `${name} が無い`);
  }
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  // **文書とメタデータを食い違わせない。** autodrive-dev-kit の一覧に出るのはこちらである。
  assert.equal(pkg.license, "Apache-2.0", "package.json の license が違う");
  assert.match(readFileSync(join(KIT, "NOTICE"), "utf8"), new RegExp(pkg.author ?? "^$"),
    "NOTICE と package.json の author が食い違っている");
});

// **規約が指す節は、置いたテンプレートに実在する**（AUT-257）。名前がずれると、
// 立ち上げで決めたことの置き場所が無く、前の版で始めたプロジェクトでは毎回聞き直す。
test("付ける文書を決める手順が、what-why.md の節を指している", () => {
  const root = project();
  init(root, KIT);
  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");
  const whatWhy = readFileSync(join(root, "docs", "what-why.md"), "utf8");
  assert.ok(rules.includes('"Documents to include"'), "規約が置き場所を指していない");
  assert.ok(whatWhy.includes("\n## Documents to include\n"), "what-why.md に節が無い");
  // **前の版の名前も読む**（AUT-263）。既に配った what-why.md はプロジェクトのものであり、
  // 雛形を英語にしても日本語のまま残る。読めないと、決め終えたプロジェクトで毎回聞き直す。
  assert.ok(rules.includes('"付ける文書"'), "前の版の節の名前を読んでいない");
  assert.ok(rules.includes("`（ここに書く）`"), "前の版の目印を読んでいない");
  // **読み手ごとにディレクトリで分ける**（AUT-260）。「操作手順書」だけでは、開発する人の
  // 手順か、本番を運用する人の手順かが読めなかった。
  for (const [doc, dir] of [
    ["Developer guide", "docs/guides/developer/"],
    ["Operator guide", "docs/guides/operator/"],
    ["User manual", "docs/guides/user/"],
  ]) {
    const row = whatWhy.split("\n").find((l) => l.startsWith(`| ${doc} |`));
    assert.ok(row?.includes(`\`${dir}\``), `${doc} の行が ${dir} を指していない`);
  }
  assert.equal(whatWhy.includes("docs/operations.md"), false, "読み手の決まらない手順書が残っている");
  // 外へ出す2つは、リリース前に HTML にするかを決めて残せる。
  assert.ok(whatWhy.includes("Turn into HTML before release"), "HTML にするかの欄が無い");
  // 前の版の形で決めたプロジェクトも、聞き直しの対象になる。
  assert.ok(rules.includes("does not point to `docs/guides/`"), "前の版の形で決めたところを拾っていない");
});
