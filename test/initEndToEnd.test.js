/**
 * `init` した先が、それだけで成り立つかを確かめる。
 *
 * **Claude は起動しない。** 確かめたいものが2つ混ざるためである。
 *
 *   土台が正しく置かれ、それだけで判定が通るか   → 決定的。速い。ここで見る
 *   AIが置かれた規約に従うか                     → 非決定的。人が見る
 *
 * 前者だけでも、置き忘れ・参照の食い違い・バージョンの固定漏れは捕まる。**後者を混ぜると、
 * 判定基準そのものが曖昧になる。**
 *
 * 人の目で何度も不具合が出るようなら、そのときに後者も見る形を考える。**きっかけは
 * 人の負担が上がったこと**であり、いま先回りして作るものではない。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { VENDOR_DIR } from "../src/vendored/internal/init.js";
import { FROM_SOURCE } from "../src/vendored/internal/setup.js";
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

  execFileSync(join(KIT, "src", "vendored", "bin", "autodrive-dev-kit"), ["init"], {
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
// 変わる形だと、プロジェクトごとに違うバージョンで動けない。
test("autodrive-dev-kit がプロジェクトの中に置かれ、そこから動く", () => {
  const root = initialized();

  for (const p of ["invariants", "VERSION", "internal", "hooks", "bin"]) {
    assert.ok(existsSync(join(root, VENDOR_DIR, p)), `${VENDOR_DIR}/${p} が無い`);
  }

  const { out } = run(root, ["--root", ".", "--scope", "self"]);
  assert.ok(out.includes("不変条件"), `判定が動いていない: ${out.slice(0, 200)}`);
});

test("複製した時点のバージョンが、置かれた先に残る", () => {
  const root = initialized();
  const there = readFileSync(join(root, VENDOR_DIR, "VERSION"), "utf8").trim();
  const here = readFileSync(join(KIT, "VERSION"), "utf8").trim();
  assert.equal(there, here);
  assert.notEqual(there, "", "バージョンが空");
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
/**
 * 置かれた規約。**2つある。**
 *
 * 毎回読む `docs/autodrive.md` と、引く `docs/autodrive-reference.md`。
 * **どちらに書いてあっても、配られていればよい**（AUT-196）。片方しか見ないと、
 * 移した先が空でも通る。
 */
function placedRules(root) {
  return ["autodrive.md", "autodrive-reference.md"]
    .map((f) => readFileSync(join(root, "docs", f), "utf8"))
    .join("\n");
}

test("置かれた文書が、更新を外から取る形で案内している", () => {
  const root = initialized();
  const rules = placedRules(root);

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
  for (const p of ["docs/boundary-changes.md", "test"]) {
    assert.equal(existsSync(join(root, p)), false, `${p} を作ってしまっている`);
  }
  // **ADR は索引だけ**（AUT-255）。判断そのものは、そのプロジェクトが書く。
  assert.deepEqual(readdirSync(join(root, "docs", "adr")), ["README.md"], "ADR そのものを作ってしまっている");
});

// autodrive-dev-kit の中に、そのプロジェクトに要らないものを持ち込まない。
test("参照実装のテストや文書は複製しない", () => {
  const root = initialized();
  for (const p of ["test", "docs", "templates", "telemetry", "src"]) {
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
  assert.ok(rules.includes("Do not ask back"), rules.slice(0, 400));
});

// **始まりの合図が、機械的に決まること。** 「テンプレートのまま」を目で判断させると、
// 判断がぶれる。指している文書が実在し、その中に「残っていればテンプレート」と分かる目印が
// あって初めて、合図として働く。**どちらが欠けても空振りする。**
test("始まりの合図が、指した先に実在する", () => {
  const root = initialized();
  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");

  // 判断の表の行から、見る先と目印を読む。**本文の他の言及ではなく、表の行から取る。**
  const row = rules.split("\n").find((l) => l.startsWith("| `") && l.includes("still the template"));
  assert.ok(row, "どこから始めるかの表が無い");

  const [, path, marker] = row.match(/`([^`]+)`.*`([^`]+)`/) ?? [];
  assert.ok(path && marker, `表の行から見る先と目印を読めない: ${row}`);

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
  const rules = placedRules(root);

  // 節が揃っていること。**1つでも欠けると、その判断だけが配られない。**
  for (const section of [
    "Behavior and stance",
    "How to stop",
    "Do not make decisions on the human's behalf",
    "Check whether it is a constraint by its source",
    "Verify a means of checking when you build it",
    "Signs to stop and reconsider",
    "What needs human approval",
    "Port vocabulary",
  ]) {
    assert.ok(rules.includes(section), `配る規約に「${section}」が無い`);
  }
});

// **停止の作法は、4点そろって意味を持つ。** 1つ欠けると、止められた人が
// 動けなくなる（定義§4「人の関与あたりの成果」）。
test("停止の作法が、4点そろっている", () => {
  // **節の切り方に依らない。** 毎回読むほうに4点、引くほうに細かい作法がある。
  const section = placedRules(initialized());

  for (const point of ["Why it is needed", "What to do", "Material for the judgment", "A fallback if they get stuck"]) {
    assert.ok(section.includes(point), `停止の作法に「${point}」が無い`);
  }
  // **例を添えること。** 4点を並べるだけでは、何が悪い問いかけかが伝わらない。
  assert.ok(section.includes("Bad example") && section.includes("Good example"), "例が無い");
});

// **出所の表が、配られた先の出所を指すこと。** 参照実装のものをそのまま配ると、
// 「この作業ルール」がどれを指すのか、受け取った側から読めない。
test("制約の出所が、配られた先から見て正しい", () => {
  const rules = placedRules(initialized());
  const section = rules.slice(
    rules.indexOf("Check whether it is a constraint by its source"),
    rules.indexOf("Do not trade a design defect"),
  );

  assert.ok(section.includes("This document"), "配られたこの文書が、出所として挙がっていない");
  assert.ok(section.includes("CLAUDE.md"), "プロジェクト固有の規約が、出所として挙がっていない");
  // **自分の推論を制約として扱わないこと。** ここが要である。
  // 本文で触れているだけでは足りない。**表に、制約ではないものとして並ぶこと。**
  const row = section
    .split("\n")
    .find((l) => l.startsWith("|") && l.includes("Your own reasoning"));
  assert.ok(row, "出所の表に「自分の推論」が無い");
  assert.ok(row.includes("Not a constraint"), `制約ではないと書かれていない: ${row}`);
});

// **このワークディレクトリに固有のものは配らない**（BOOTSTRAP 段階5の仕分け）。
test("このワークディレクトリに固有のものは配らない", () => {
  const rules = readFileSync(join(initialized(), "docs", "autodrive.md"), "utf8");
  for (const local of ["BOOTSTRAP", "autodrive-dev-work", "agent-playground", "題材アプリ", "現在の段階"]) {
    assert.equal(rules.includes(local), false, `配る規約に、このワークディレクトリのもの「${local}」が入っている`);
  }
});

// **「人の言語で話す」は配らない**（人の判断、AUT-196）。フロンティアのモデルを
// 使う前提では当然のことであり、**書くほど毎回読ませる量が増える。**
//
// 落としたのは指示だけで、**振る舞いを変えたのではない。** 相手の言語で書くことは
// 変わらない。

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

  assert.ok(notes.includes("It is yours"), notes.slice(0, 400));
  assert.ok(notes.includes("does not rewrite it on its own"), "AIが書かないことが書かれていない");
});

// **置いてはいけないものを書く。** 追跡しないことと、守られていることは別である。
test("置き場所が、置いてはいけないものを言っている", () => {
  const notes = readFileSync(join(initialized(), "notes", "README.md"), "utf8");

  // **節として在ること。** どこかに語が出ているだけでは、読む人が辿り着けない。
  const start = notes.indexOf("## What must not be put here");
  assert.ok(start >= 0, "置いてはいけないものの節が無い");

  const section = notes.slice(start, notes.indexOf("## Where values go"));

  // **何が駄目なのかを、具体的に挙げること。** 「資格情報」とだけ言われても、
  // 読む人は自分の持っているものがそれに当たるか判断できない。
  const named = ["secrets", "signing keys", "tokens", "password"].filter((k) =>
    section.includes(k),
  );
  assert.ok(named.length >= 2, `具体的に挙げていない（${named.join(", ") || "なし"}）`);
  assert.ok(
    section.includes("Not being tracked and being protected are different things"),
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
  assert.ok(ignore.includes("Sharing it breaks things"), "なぜ追跡しないのかが書かれていない");
  // **無い状態が黙って通らないこと**も、ここで伝える。
  assert.ok(ignore.includes("unattributed"), ignore);
});

// ------------------------------------------------------ 最初のコミット（AUT-239）

/** `init` した一式をコミットして、判定を打つ。 */
function committedAndJudged(extra = () => {}) {
  const root = initialized();
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"] });

  git("add", "-A");
  git("commit", "-q", "-m", "init で置いた一式");
  extra(root, git);

  // **落ちても出力を拾う。** 素のプロジェクトは記録がまだ無く、そちらで終了コードが
  // 1 になる。**投げたまま捨てると、見たい判定の行まで失う。**
  let out;
  try {
    out = execFileSync(
      "node",
      [join(KIT, "src", "vendored", "internal", "main.js"), "--root", root, "--scope", "self"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    out = String(error.stdout ?? "") + String(error.stderr ?? "");
  }
  return { root, git, out };
}

/**
 * **置いた一式をコミットしただけで落ちていた**（GitHub #102）。
 *
 * `init` した全プロジェクトが最初の提出で踏む。**手元では通っていた** ——
 * `boundaries.yaml` が未コミットの間は `git log` が空を返すためである。
 * **コミットした瞬間に落ちる。**
 *
 * 単体の作り物では捕まらなかった。`git` の作り物が、何を聞かれても同じ値を
 * 返していたためである。**実物のリポジトリでしか出ない。**
 */
test("init した一式をコミットしただけでは、委譲範囲の判定が落ちない", () => {
  const { out } = committedAndJudged();

  const section = out.slice(out.indexOf("委譲範囲の変更が履歴に残ること"));
  assert.ok(
    out.includes("[有効] 委譲範囲の変更が履歴に残ること"),
    `置いただけで落ちている:\n${section.slice(0, 400)}`,
  );
  // **何を見てそう言っているかを出す。** 通ったことだけでは、見ていないのと区別できない。
  assert.ok(out.includes("initial placement"), `初期設置だと言っていない:\n${section.slice(0, 400)}`);
});

// **緩めすぎていないこと。** 動かした変更は、これまでどおり履歴を求める。
test("委譲範囲を動かした変更は、履歴が無ければ落ちる", () => {
  const { out } = committedAndJudged((root, git) => {
    writeFileSync(
      join(root, "boundaries.yaml"),
      "version: 1\nareas:\n  - id: implement/product-code\n    operation: 実装する\n" +
        "    target: プロダクトのコード\n    detectable: true\n    reversible: true\n    state: 観察中\n",
      "utf8",
    );
    git("add", "-A");
    git("commit", "-q", "-m", "委譲範囲を動かす");
  });

  assert.ok(
    out.includes("[要対応] 委譲範囲の変更が履歴に残ること"),
    `動かしたのに落ちていない:\n${out.slice(out.indexOf("委譲範囲"), out.indexOf("委譲範囲") + 400)}`,
  );
});

// 履歴に書けば通ること。**通る道があることまで確かめる。**
test("動かした変更を履歴に書けば、通る", () => {
  const { out } = committedAndJudged((root, git) => {
    writeFileSync(
      join(root, "boundaries.yaml"),
      "version: 1\nareas:\n  - id: implement/product-code\n    operation: 実装する\n" +
        "    target: プロダクトのコード\n    detectable: true\n    reversible: true\n    state: 観察中\n",
      "utf8",
    );
    git("add", "-A");
    git("commit", "-q", "-m", "委譲範囲を動かす");
    const sha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "docs", "boundary-changes.md"),
      `## 2026-09-23 実装を観察中へ\n- 根拠: 実績なし（初期の観察）\n- 設定変更: commit ${sha}\n`,
      "utf8",
    );
    git("add", "-A");
    git("commit", "-q", "-m", "履歴を足す");
  });

  assert.ok(
    out.includes("[有効] 委譲範囲の変更が履歴に残ること"),
    `履歴を書いても通らない:\n${out.slice(out.indexOf("委譲範囲"), out.indexOf("委譲範囲") + 400)}`,
  );
});
