/**
 * `init` した先が、それだけで成り立つかを確かめる。
 *
 * **Claude は起動しない。** 確かめたいものが2つ混ざるためである。
 *
 *   土台が正しく置かれ、それだけで判定が通るか   → 決定的。速い。ここで見る
 *   AIが置かれた規約に従うか                     → 非決定的。人が見る
 *
 * 前者だけでも、置き忘れ・参照の食い違い・版の固定漏れは捕まる。**後者を混ぜると、
 * 判定基準そのものが曖昧になる。**
 *
 * 人の目で何度も不具合が出るようなら、そのときに後者も見る形を考える。**きっかけは
 * 人の負担が上がったこと**であり、いま先回りして作るものではない。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { VENDOR_DIR } from "../src/init.js";
import { FROM_SOURCE } from "../src/setup.js";
import { tempDir } from "./helpers/tmp.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 素のリポジトリを作り、`init` を通す。 */
function initialized() {
  const root = tempDir("autodrive-e2e-");
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"] });

  git("init", "-q");
  git("config", "user.name", "テスト");
  git("config", "user.email", "test@example.invalid");

  execFileSync(join(KIT, "bin", "autodrive-dev-kit"), ["init"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return root;
}

/** 置かれた先の autodrive-dev-kit を、置かれた先から実行する。 */
function run(root , args) {
  try {
    const out = execFileSync(join(root, VENDOR_DIR, "invariants"), args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, AUTODRIVE_CI_TOKEN: "", LINEAR_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (error) {
    const e = error;
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

// ------------------------------------------------------------ autodrive-dev-kit が動くか

// **手元の参照実装を指していないこと。** 参照実装を更新した瞬間に全プロジェクトが
// 変わる形だと、プロジェクトごとに違う版で動けない。
test("autodrive-dev-kit がプロジェクトの中に置かれ、そこから動く", () => {
  const root = initialized();

  for (const p of ["invariants", "verify", "VERSION", "src", "hooks", "bin"]) {
    assert.ok(existsSync(join(root, VENDOR_DIR, p)), `${VENDOR_DIR}/${p} が無い`);
  }

  const { out } = run(root, ["--root", ".", "--scope", "self"]);
  assert.ok(out.includes("不変条件"), `判定が動いていない: ${out.slice(0, 200)}`);
});

test("複製した時点の版が、置かれた先に残る", () => {
  const root = initialized();
  const there = readFileSync(join(root, VENDOR_DIR, "VERSION"), "utf8").trim();
  const here = readFileSync(join(KIT, "VERSION"), "utf8").trim();
  assert.equal(there, here);
  assert.notEqual(there, "", "版が空");
});

// ------------------------------------------------------------ 参照の食い違い

// **置いた文書が、置いた場所を指していること。** ここがずれると、初日に動かない。
test("置かれた設定が、置かれた autodrive-dev-kit を指している", () => {
  const root = initialized();

  const workflow = readFileSync(join(root, ".github", "workflows", "invariants.yml"), "utf8");
  assert.ok(workflow.includes(`${VENDOR_DIR}/invariants`), workflow);
  assert.equal(workflow.includes("git clone"), false, "取りに行く形が残っている");

  const settings = readFileSync(join(root, ".claude", "settings.json"), "utf8");
  assert.ok(settings.includes(`${VENDOR_DIR}/hooks/record-tokens`), settings);

  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");
  assert.ok(rules.includes(`${VENDOR_DIR}/bin/autodrive-dev-kit`), rules);
  assert.equal(rules.includes("{{KIT}}"), false, "置き換えが残っている");
});

// **更新だけは、置かれた autodrive-dev-kit を指していてはいけない。** 複製にはテンプレートが
// 入っていないため、案内どおりに打つと必ず落ちる（AUT-152）。
test("置かれた文書が、更新を外から取る形で案内している", () => {
  const root = initialized();
  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");

  assert.ok(rules.includes(`${FROM_SOURCE} update`), rules.slice(0, 400));
  assert.equal(
    rules.includes(`${VENDOR_DIR}/bin/autodrive-dev-kit update`),
    false,
    "複製先で update を打たせている",
  );
});

// ------------------------------------------------------------ 判定の中身

// **記録が1件も無い状態から始まる。** そこで何が言われるかは、初日の体験そのもの。
test("記録が無い状態でも、判定は落ちずに何が足りないかを言う", () => {
  const root = initialized();
  const { out } = run(root, ["--root", ".", "--scope", "self"]);

  assert.ok(out.includes("テレメトリが記録されること"), out.slice(0, 300));
  // 資格情報が無い状態で、それと分かること。**黙って通らない。**
  assert.ok(out.length > 0);
});

// ------------------------------------------------------------ 何を置かないか

// **固有のものは生成しない**（BOOTSTRAP 段階5）。テンプレートを置くと中身が無いまま残る。
test("固有のものは生成しない", () => {
  const root = initialized();
  for (const p of ["docs/adr", "docs/boundary-changes.md", "test"]) {
    assert.equal(existsSync(join(root, p)), false, `${p} を作ってしまっている`);
  }
});

// autodrive-dev-kit の中に、そのプロジェクトに要らないものを持ち込まない。
test("参照実装のテストや文書は複製しない", () => {
  const root = initialized();
  for (const p of ["test", "docs", "templates", "telemetry"]) {
    assert.equal(existsSync(join(root, VENDOR_DIR, p)), false, `${VENDOR_DIR}/${p} を複製している`);
  }
});

// **複製しないことと、打てると案内することは両立しない。**
//
// 上の試験は正しいものを守っていた。**足りなかったのは、打てない場所で打たれた
// ときの出方である。** 題材アプリ2は、配られた文書の案内どおりに複製先で打ち、
// ENOENT の生ログを受け取って詰まった（AUT-152）。
test("複製した先から update を打つと、理由を言って止まる", () => {
  const root = initialized();

  let out;
  let code = 0;
  try {
    out = execFileSync(join(root, VENDOR_DIR, "bin", "autodrive-dev-kit"), ["update"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const e = error;
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    code = e.status ?? 1;
  }

  assert.equal(code, 1, `止まっていない: ${out.slice(0, 300)}`);
  // **打ち直せる形を出す。** 止めるだけでは、次に何を打てばよいかが分からない。
  assert.ok(out.includes(`${FROM_SOURCE} update`), out.slice(0, 400));
  // **生ログを出さない。** 読んだ人には、何が起きたのかが分からない。
  assert.equal(out.includes("ENOENT"), false, out.slice(0, 400));
  assert.equal(out.includes("at template"), false, out.slice(0, 400));
});

// ------------------------------------------------------------ 始まりの合図

// **人に始め方を覚えさせない。** 置かれた文書がどこから始めるかを言えていないと、
// 人は「AIになんて言えばいいのか」から詰まる（AUT-80）。
test("置かれた文書が、どこから始めるかを言っている", () => {
  const root = initialized();
  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");

  assert.ok(rules.includes("docs/what-why.md"), "始まりの判断材料を指していない");
  assert.ok(rules.includes("聞き返さない"), rules.slice(0, 400));
});

// **始まりの合図が、機械的に決まること。** 「テンプレートのまま」を目で判断させると、
// 判断がぶれる。指している文書が実在し、その中に「残っていればテンプレート」と分かる印が
// あって初めて、合図として働く。**どちらが欠けても空振りする。**
test("始まりの合図が、指した先に実在する", () => {
  const root = initialized();
  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");

  // 判断の表の行から、見る先と印を読む。**本文の他の言及ではなく、表の行から取る。**
  const row = rules.split("\n").find((l) => l.startsWith("| `") && l.includes("テンプレートのまま"));
  assert.ok(row, "どこから始めるかの表が無い");

  const [, path, marker] = row.match(/`([^`]+)`.*`([^`]+)`/) ?? [];
  assert.ok(path && marker, `表の行から見る先と印を読めない: ${row}`);

  const target = join(root, path);
  assert.ok(existsSync(target), `${path} を指しているが、置かれていない`);
  assert.ok(
    readFileSync(target, "utf8").includes(marker),
    `${path} に ${marker} が無い。合図が空振りする`,
  );
});

// ------------------------------------------------------------ 配るもの

// **手順だけを配っても、この手法にはならない。** 手順は何をするかを言うが、
// どう判断するかを言わない。段階5の完了条件は「素のディレクトリに init して
// 段階0〜3が再現できる」ことであり、判断の仕方が無いと再現しない（AUT-93）。
test("配る規約に、振る舞いとスタンスが入っている", () => {
  const root = initialized();
  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");

  // 節が揃っていること。**1つでも欠けると、その判断だけが配られない。**
  for (const section of [
    "振る舞いとスタンス",
    "停止するときの作法",
    "意思決定は代行しない",
    "制約かどうかを、出所で確かめる",
    "確認の手段は、作った時点で検証する",
    "立ち止まる合図",
    "人の承認が必要なもの",
    "ポート語彙",
  ]) {
    assert.ok(rules.includes(section), `配る規約に「${section}」が無い`);
  }
});

// **停止の作法は、4点そろって意味を持つ。** 1つ欠けると、止められた人が
// 動けなくなる（定義§4「人の関与あたりの成果」）。
test("停止の作法が、4点そろっている", () => {
  const rules = readFileSync(join(initialized(), "docs", "autodrive.md"), "utf8");
  const section = rules.slice(rules.indexOf("### 停止するときの作法"), rules.indexOf("### 意思決定"));

  for (const point of ["なぜ必要か", "何をすればよいか", "判断の材料", "詰まったとき"]) {
    assert.ok(section.includes(point), `停止の作法に「${point}」が無い`);
  }
  // **例を添えること。** 4点を並べるだけでは、何が悪い問いかけかが伝わらない。
  assert.ok(section.includes("悪い例") && section.includes("良い例"), "例が無い");
});

// **出所の表が、配られた先の出所を指すこと。** 参照実装のものをそのまま配ると、
// 「この作業ルール」がどれを指すのか、受け取った側から読めない。
test("制約の出所が、配られた先から見て正しい", () => {
  const rules = readFileSync(join(initialized(), "docs", "autodrive.md"), "utf8");
  const section = rules.slice(
    rules.indexOf("### 制約かどうかを、出所で確かめる"),
    rules.indexOf("### 設計上の欠陥"),
  );

  assert.ok(section.includes("この文書"), "配られたこの文書が、出所として挙がっていない");
  assert.ok(section.includes("CLAUDE.md"), "プロジェクト固有の規約が、出所として挙がっていない");
  // **自分の推論を制約として扱わないこと。** ここが要である。
  // 本文で触れているだけでは足りない。**表に、制約ではないものとして並ぶこと。**
  const row = section
    .split("\n")
    .find((l) => l.startsWith("|") && l.includes("自分の推論"));
  assert.ok(row, "出所の表に「自分の推論」が無い");
  assert.ok(row.includes("制約ではない"), `制約ではないと書かれていない: ${row}`);
});

// **このワークディレクトリに固有のものは配らない**（BOOTSTRAP 段階5の仕分け）。
test("このワークディレクトリに固有のものは配らない", () => {
  const rules = readFileSync(join(initialized(), "docs", "autodrive.md"), "utf8");
  for (const local of ["BOOTSTRAP", "autodrive-dev-work", "agent-playground", "題材アプリ", "現在の段階"]) {
    assert.equal(rules.includes(local), false, `配る規約に、このワークディレクトリのもの「${local}」が入っている`);
  }
});

// **人の言語で話すこと。** この文書は日本語で書かれているが、それはAIが読むため
// である。人に向けて出すものは相手の言語で書く（AUT-102）。
test("配る規約が、人の言語で話すことを求めている", () => {
  const rules = readFileSync(join(initialized(), "docs", "autodrive.md"), "utf8");

  assert.ok(rules.includes("人の言語で話す"), "人の言語で話すことが書かれていない");
  // **規約を訳して置き直さないこと。** 訳が古くなると、AIが従う規約と人が読む
  // 規約が食い違う。
  assert.ok(rules.includes("訳して置き直さない"), rules.slice(rules.indexOf("人の言語"), 600));
  assert.ok(rules.includes("その場で言い直す"), "どうするかが書かれていない");
});

// ------------------------------------------------------------ 人の置き場所

// **人が考えをまとめる場所を配る。** AIに指示する前に使うものであり、
// 置き場所が無ければ、人はプロジェクトの外に散らすことになる（AUT-104）。
test("人が使う置き場所を置き、中身は追跡しない", () => {
  const root = initialized();

  assert.ok(existsSync(join(root, "notes", "README.md")), "置き場所が無い");

  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.ok(ignore.includes("notes/*"), ignore);
  // **README だけは追跡する。** 全部を無視すると、クローンした先にディレクトリ
  // 自体が無くなり、「何を置いてはいけないか」が消える。
  assert.ok(ignore.includes("!notes/README.md"), ignore);
});

// **誰のものかを書く。** 曖昧だと、人が整理した資料をAIが上書きしうる。
test("置き場所が、誰のものかを言っている", () => {
  const notes = readFileSync(join(initialized(), "notes", "README.md"), "utf8");

  assert.ok(notes.includes("あなたのもの"), notes.slice(0, 400));
  assert.ok(notes.includes("自分から書き換えない"), "AIが書かないことが書かれていない");
});

// **置いてはいけないものを書く。** 追跡しないことと、守られていることは別である。
test("置き場所が、置いてはいけないものを言っている", () => {
  const notes = readFileSync(join(initialized(), "notes", "README.md"), "utf8");

  // **節として在ること。** どこかに語が出ているだけでは、読む人が辿り着けない。
  const start = notes.indexOf("## 置いてはいけないもの");
  assert.ok(start >= 0, "置いてはいけないものの節が無い");

  const section = notes.slice(start, notes.indexOf("## 値はどこに置く"));

  // **何が駄目なのかを、具体的に挙げること。** 「資格情報」とだけ言われても、
  // 読む人は自分の持っているものがそれに当たるか判断できない。
  const named = ["シークレット", "署名鍵", "トークン", "パスワード"].filter((k) =>
    section.includes(k),
  );
  assert.ok(named.length >= 2, `具体的に挙げていない（${named.join(", ") || "なし"}）`);
  assert.ok(
    section.includes("追跡しないことと、守られていることは別"),
    "追跡と保護を取り違えさせない説明が無い",
  );
  // 代わりにどこへ置くかまで書く。**置くなと言うだけでは、行き先が無い。**
  assert.ok(notes.includes(".env"), "値の置き場所が書かれていない");
});

// **作業状態は共有しない。** 共有すると、クローンした人が他人の作業単位に
// 着手している状態で始まる。
test("作業状態を追跡しない。理由も書いてある", () => {
  const ignore = readFileSync(join(initialized(), ".gitignore"), "utf8");

  assert.ok(ignore.includes(".autodrive/"), ignore);
  assert.ok(ignore.includes("共有すると壊れる"), "なぜ追跡しないのかが書かれていない");
  // **無い状態が黙って通らないこと**も、ここで伝える。
  assert.ok(ignore.includes("unattributed"), ignore);
});
