/**
 * 文書に載っているコマンドが、実在すること。
 *
 * **文書にはテストが無い。** コマンドを変えたとき、文書が追随しなかったことに
 * 気づく機会が無い。実際に出た（AUT-79 で `--type` を足したとき、`docs/design.md`
 * の書式が置き去りになった。見つかったのは次の作業単位である）。
 *
 * 実在するかどうかは機械で見られる。**書いてあることが正しいかまでは見ない。**
 * ここで見るのは、呼べるかどうかまで。
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { delegateFor, MODES } from "../src/cli.js";
import { brokenEmphasis } from "../src/emphasis.js";
import { OPERATIONS as TELEMETRY_OPS } from "../src/telemetryCli.js";
import { OPERATIONS as TRACKER_OPS } from "../src/trackerCli.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 文書を集める。**追加された文書も勝手に対象になる。** 一覧を手で保つと、漏れる。 */
function documents() {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".md")) found.push(full);
    }
  };
  walk(join(KIT, "docs"));
  walk(join(KIT, "templates"));
  found.push(join(KIT, "README.md"));
  return found;
}

/**
 * 打っている行だけを取り出す。
 *
 * **囲みの中の、行の先頭に限る。** 地の文にコマンド名が出るのは説明であって、
 * 打つ形ではない。囲みの中でも、引数として名前が出ることがある。
 */
function invocations(body) {
  const out = [];
  let inFence = false;

  body.split("\n").forEach((text, i) => {
    if (text.trimStart().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (!inFence) return;

    // **行の先頭で打たれているものだけ。** 引数として名前が出ることがある
    // （`git -C my-app checkout main`）。それは打っている形ではない。
    // 雛形は複製先を `{{KIT}}/bin/` として持つため、前置きの経路は許す。
    const m = text.match(/^\s*(?:\$\s+)?(?:[\w.{}/-]*\/)?autodrive-dev-kit\s+(\S+)(?:\s+(\S+))?/);
    if (m === null) return;
    out.push({ line: i + 1, command: m[1], operation: m[2] ?? null });
  });
  return out;
}


/** 文書から、打たれているコマンドを拾う。 */
function mentions() {
  const found = [];
  for (const doc of documents()) {
    for (const call of invocations(readFileSync(doc, "utf8"))) {
      found.push({ doc: doc.slice(KIT.length + 1), ...call });
    }
  }
  return found;
}

// **見る範囲が狭まったことに気づけること。** 拾えた件数だけを見ていると、
// 一箇所を見なくなっても他が埋め合わせてしまい、判定が黙って弱くなる。
test("文書を集める範囲が、狭まっていない", () => {
  const collected = documents().map((d) => d.slice(KIT.length + 1));
  for (const must of ["README.md", "docs/commands.md", "docs/design.md", "templates/autodrive.md"]) {
    assert.ok(collected.includes(must), `${must} を見ていない`);
  }
});

test("文書に載っているコマンドが実在する", () => {
  const known = (c) => MODES.has(c) || delegateFor(c) !== null;
  const seen = mentions();
  assert.ok(seen.length > 0, "コマンドの記載を1つも拾えていない。拾い方が壊れている");

  for (const m of seen) {
    assert.ok(known(m.command), `${m.doc}:${m.line} に無いコマンド: ${m.command}`);
  }
});

test("文書に載っている操作が実在する", () => {
  const table = {
    telemetry: TELEMETRY_OPS,
    tracker: TRACKER_OPS,
  };

  let checked = 0;
  for (const m of mentions()) {
    const ops = table[m.command];
    if (ops === undefined || m.operation === null) continue;
    // 説明文の中の言及（「telemetry の…」）は拾わない。操作名の形をしたものだけ。
    if (m.operation.startsWith("-") || m.operation.startsWith("<")) continue;
    assert.ok(ops[m.operation] !== undefined, `${m.doc}:${m.line} に無い操作: ${m.command} ${m.operation}`);
    checked += 1;
  }
  assert.ok(checked > 0, "操作の記載を1つも拾えていない。拾い方が壊れている");
});

// **人が打つものと、AIが打つものを取り違えさせない。** 使う人が打つのは3つだけで、
// そこを間違えると「覚えることを増やさない」という前提が崩れる。
test("README は、人が打つものだけを使い方として出す", () => {
  const readme = readFileSync(join(KIT, "README.md"), "utf8");
  const upTo = readme.slice(0, readme.indexOf("## 関連ファイル"));

  const calls = invocations(upTo);
  assert.ok(calls.length > 0, "使い方に、打つ形が1つも無い");
  for (const c of calls) {
    assert.ok(MODES.has(c.command), `使い方に、人が打たないコマンドが出ている: ${c.command}`);
  }
  for (const mode of MODES) {
    assert.ok(upTo.includes(`autodrive-dev-kit ${mode}`) || upTo.includes(`\`${mode}\``), `${mode} が案内に無い`);
  }
});

// **移した内容が消えていないこと。** 読み手を替えるために削ったものは、根拠ごと
// 失われる。README から外したものは docs/commands.md にある。
test("参照実装を触る人向けの内容が、移した先にある", () => {
  const commands = readFileSync(join(KIT, "docs", "commands.md"), "utf8");
  for (const kept of ["--enact", "--substitute", "終了コード", "作業単位マーカー", "record-tokens"]) {
    assert.ok(commands.includes(kept), `docs/commands.md に ${kept} が無い`);
  }
});

// ------------------------------------------------------------ 置かれるものの一覧

// **README の一覧が、実際に置かれるものと一致すること。** 一覧は手で保たれており、
// 置くものを変えたときに追随しなかったことに気づく機会が無い。**初日に見る表が
// 間違っていると、そこで詰まる。**
test("README の一覧が、実際に置かれるものと一致する", async () => {
  // **人が打つ経路をそのまま使う。** 下位の関数を直に呼ぶと、そこでは置かれない
  // ものが表から漏れる（実際に autodrive.json で漏れた）。
  const { setup } = await import("../src/setup.js");
  const { useRecommended } = await import("../src/ports/interview.js");
  const { mkdirSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const root = mkdtempSync(join(tmpdir(), "autodrive-readme-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  const placed = setup("init", root, KIT, useRecommended).placed.map((p) => p.path);

  const readme = readFileSync(join(KIT, "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("## 関連ファイル"), readme.indexOf("## 仕組み"));

  // 表の1列目のうち、`init` の行だけを見る。
  const listed = [...section.matchAll(/^\| `([^`]+)` \| init \|/gm)].map((m) => m[1]);
  assert.ok(listed.length > 0, "init で置かれるものの一覧を拾えていない");

  for (const path of listed) {
    assert.ok(placed.includes(path), `README に載っているが置かれない: ${path}`);
  }
  for (const path of placed) {
    assert.ok(listed.includes(path), `置かれるのに README に無い: ${path}`);
  }
});

// **生成しないものが、生成しないままであること。** 雛形を置くと中身が無いまま残る。
test("後から作られると書いたものは、init では作られない", async () => {
  const { setup } = await import("../src/setup.js");
  const { useRecommended } = await import("../src/ports/interview.js");
  const { existsSync, mkdirSync, mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const readme = readFileSync(join(KIT, "README.md"), "utf8");
  const section = readme.slice(readme.indexOf("## 関連ファイル"), readme.indexOf("## 仕組み"));

  const later = [...section.matchAll(/^\| `([^`]+)` \| (?!init \|)[^|]+\|/gm)].map((m) => m[1]);
  assert.ok(later.length > 0, "後から作られるものの一覧を拾えていない");

  const root = mkdtempSync(join(tmpdir(), "autodrive-later-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  setup("init", root, KIT, useRecommended);

  for (const path of later) {
    // 作業単位IDのような差し込みを含む行は、置き場所だけを見る。
    const target = path.includes("<") ? path.slice(0, path.indexOf("<")) : path;
    assert.equal(existsSync(join(root, target)), false, `後から作ると書いてあるのに置いている: ${path}`);
  }
});

// ------------------------------------------------------------ 強調が効いているか

// **日本語では `**強調**` が黙って効かなくなる。** 助詞が直後に続くと、CommonMark の
// 規則で閉じられない。書いた側には見えず、読む側には平文として届く。
// 実際に出た（README で1箇所指摘され、調べたら文書全体で20箇所を超えていた）。
test("強調が、強調として表示される", () => {
  const broken = [];
  for (const doc of documents()) {
    for (const b of brokenEmphasis(readFileSync(doc, "utf8"))) {
      broken.push(`${doc.slice(KIT.length + 1)}:${b.line}  ${b.text.slice(0, 70)}`);
    }
  }
  assert.deepEqual(broken, [], `閉じられていない ** がある:\n${broken.join("\n")}`);
});

// **判定が本当に見つけられること。** 空の配列は、見ていなくても出る。
test("助詞が続く強調を、実際に見つける", () => {
  assert.equal(brokenEmphasis("**開発に必要な環境**は必要に応じて構築します。").length, 1);
  assert.equal(brokenEmphasis("**履歴に載っていないと固定にならない**ため。").length, 1);

  // 閉じられる形は、見つけない。
  assert.equal(brokenEmphasis("**この版で動く。** 参照実装を更新しても変わらない。").length, 0);
  assert.equal(brokenEmphasis("**既存の CI が呼んでいるため**、壊さない。").length, 0);
  assert.equal(brokenEmphasis("英語なら **bold** is fine.").length, 0);

  // **行をまたぐ強調を誤検出しない。** 段落として見る。
  assert.equal(brokenEmphasis("これは **強調が\n行をまたぐ場合。** 続く文。").length, 0);
  // **囲みの中は対象外。** 記号としての * が入る。
  assert.equal(brokenEmphasis("```\nls **/*.ts\n```").length, 0);
});

// ------------------------------------------------------------ 配り方

// **最初の1手で詰まらせない。** clone と PATH の設定を挟むと、いちばん負担を
// かけたくない人に摩擦が当たる（AUT-96）。
test("最初に打つものが、clone も PATH も要らない形で書いてある", () => {
  const readme = readFileSync(join(KIT, "README.md"), "utf8");
  const start = readme.slice(readme.indexOf("### はじめ方"), readme.indexOf("### 開発の進め方"));

  assert.ok(start.includes("npx"), "clone せずに打てる形が書かれていない");
  assert.ok(start.includes("clone も PATH の設定も要らない"), start.slice(0, 400));
});

// **npm から辿れる形になっていること。** bin が無いと、npx は何を実行すれば
// よいか分からない（実際に「could not determine executable to run」で止まった）。
test("入口が、npm から辿れる形で宣言されている", async () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"))


   ;

  assert.ok(pkg.bin?.["autodrive-dev-kit"], "bin が宣言されていない");
  const entry = join(KIT, pkg.bin["autodrive-dev-kit"]);
  assert.ok(existsSync(entry), `bin が指す ${pkg.bin["autodrive-dev-kit"]} が無い`);

  // **Windows でも動く形であること。** シェルスクリプトだと npm が殻を作れない。
  const head = readFileSync(entry, "utf8").split("\n")[0];
  assert.equal(head, "#!/usr/bin/env node", `bin が node で始まっていない: ${head}`);
});

// **配るものを絞る。** テストも記録も、使う側には要らない。
test("配るものに、使う側が要らないものを含めない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  assert.ok(pkg.files, "files が宣言されていない");

  for (const needed of ["bin", "src", "templates"]) {
    assert.ok(pkg.files.includes(needed), `${needed} を配っていない`);
  }
  for (const unneeded of ["test", "telemetry", "docs"]) {
    assert.equal(pkg.files.includes(unneeded), false, `${unneeded} を配っている`);
  }
});

// **公開は固定条件である**（定義§9：外部への不可逆な公開）。下ごしらえだけを
// 済ませ、公開そのものは人が決める。private を外すのは、その判断の場である。
test("下ごしらえだけで、公開はしない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  assert.equal(pkg.private, true, "公開を止める印が外れている。**これは人の判断を要する**");
});

// **判定できる形にしておく。** ここが緩むと、要る版に届いていないことに気づけず
// 黙って落ちる。**確認そのものが型注釈を必要としてはいけない。**
test("要る版に届いていなければ、断る", async () => {
  const { NEEDS, tooOld, tooOldMessage } = await import("../bin/node-version.js");

  for (const old of ["18.20.0", "20.11.0", "22.0.0", "22.17.9", "22.17"]) {
    assert.equal(tooOld(old), true, `${old} を通している`);
  }
  for (const ok of [NEEDS, "22.18.0", "22.19.0", "23.0.0", "24.1.0"]) {
    assert.equal(tooOld(ok), false, `${ok} を弾いている`);
  }
  // 読めない値は、通さない側へ倒す。
  assert.equal(tooOld("わからない"), true);

  // **なぜ・どうすれば・詰まったらどうするか**（配布物「停止するときの作法」）。
  const said = tooOldMessage("20.0.0");
  assert.ok(said.includes(NEEDS), said);
  assert.ok(said.includes("型注釈"), "なぜ要るのかが無い");
  assert.ok(said.includes("nvm"), "どうすればよいかが無い");
  assert.ok(said.includes("案内します"), "詰まったときの受け皿が無い");
});

// **確認の手前で落ちない形であること。** 入口が型注釈を含むと、要る版に届いて
// いない人には、確認そのものが動かない。
test("入口だけは、型注釈を使わない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"))

   ;
  for (const file of [pkg.bin["autodrive-dev-kit"], "bin/node-version.js"]) {
    const body = readFileSync(join(KIT, file), "utf8");
    for (const typed of [": string", ": number", "as const", "interface ", "import type"]) {
      assert.equal(body.includes(typed), false, `${file} に型注釈がある: ${typed}`);
    }
  }

  // **確認が入口に繋がっていること。** 関数があっても、呼ばれなければ意味がない。
  // ここだけは中身を読んで確かめる。**古い Node を用意して動かすことができない**
  // ため、他に確かめる手段が無い。
  const entry = readFileSync(join(KIT, pkg.bin["autodrive-dev-kit"]), "utf8");
  assert.ok(entry.includes("tooOld(process.versions.node)"), "入口が版を確かめていない");

  // **「直接実行されたか」で分岐しない。** npx は別名を経由するため、分岐を置くと
  // npx 経由で何も起きなくなる。実際にそうなった（AUT-96）。
  assert.equal(entry.includes("invokedDirectly"), false, "npx 経由で動かなくなる分岐がある");
});

// ---------------------------------------------- 露出は人が決める（AUT-123）

/**
 * 配る規約。**改行を畳んで返す。**
 *
 * 文書は読みやすさのために折り返してあり、そのままだと文の途中に改行が入る。
 * 畳まずに照合すると、**内容ではなく整形の違いで落ちる。**
 */
const rules = () => readFileSync(join(KIT, "templates", "autodrive.md"), "utf8").replace(/\n/g, "");

// **配布物に書かれていなければ、次のプロジェクトで同じ既定に戻る。**
// 実際に、検証環境が誰でも到達できる状態で作られた。
test("外から見える状態にするなら人へ確かめる、と配る", () => {
  const text = rules();
  assert.ok(text.includes("既定で公開しない"), "既定を公開にしないと言っていない");
  assert.ok(text.includes("検証環境も対象である"), "検証環境が対象だと言っていない");
});

// **配布の可逆性を根拠に、露出の停止を省かせない。** それが今回の原因だった。
test("配布が戻せることと、露出が戻せることを分けて書く", () => {
  const text = rules();
  assert.ok(text.includes("露出は、戻せるが取り消せない"), "区別を書いていない");
  assert.ok(
    text.includes("公開されていた間に見られたことは取り消せない"),
    "なぜ取り消せないのかを書いていない",
  );
});

test("承認が要るものの一覧に、露出が載っている", () => {
  const approvals = rules().split("## 人の承認が必要なもの")[1] ?? "";
  assert.ok(approvals.includes("外から見える状態にする"), "一覧に無い");
});

// **「確認のために公開が必要だった」を通さない。** 通すと規約が空文になる。
test("確認のための公開も、人へ差し出す論点だと書く", () => {
  assert.ok(rules().includes("理由にならない"), "抜け道を塞いでいない");
});

// -------------------------------------- プレビューの置き場（AUT-125）

const design = () => readFileSync(join(KIT, "docs", "design.md"), "utf8").replace(/\n/g, "");

// **どこで動くのかを書く。** 書いていなかったため、別環境だと読まれた。
test("プレビューが検証環境の上に出ることを書く", () => {
  const text = design();
  assert.ok(text.includes("プレビューは検証環境の上に出る"), "どこで動くのかが無い");
  assert.ok(text.includes("--env staging"), "実際の出し方が無い");
});

// **見え方の確認を、公開の口実にしない。**
test("確認のために公開しない、と書く", () => {
  assert.ok(design().includes("見え方の確認のために公開しない"), "口実を塞いでいない");
});

// **独自ドメインが要ると思わせない。** 要らないことを確かめてある。
test("閉じたまま見せる手段があることを書く", () => {
  const text = design();
  assert.ok(text.includes("独自ドメインを用意しなくても閉じられる"), "手段が無いと読める");
  assert.ok(text.includes("WebSocket"), "使えない場合の条件を書いていない");
});

// **配布物の側からも辿れること。** 規約だけ読む人がいる。
test("配布物にも、プレビューと検証環境の関係が書いてある", () => {
  assert.ok(rules().includes("プレビューは検証環境の上に出る"), "配布物に無い");
});

// ------------------------------------- 測ってから言う（AUT-129）

// **起きていないことを「実際に起きた」と書かない。** 配布物はこれから使う人が
// 読む。根拠が崩れると、他の記述の信頼も落ちる。
test("露出の根拠を、報告として書く。測った結果として書かない", () => {
  const text = rules();
  assert.equal(
    text.includes("実際に、検証環境が誰でも到達できる状態で作られた"),
    false,
    "測っていないことを、測ったように書いている",
  );
  assert.ok(text.includes("報告があり"), "報告であることが分からない");
});

// **応答コードだけで開閉を判断させない。** それで誤報を出した。
test("開いているかの確かめ方を、具体的に配る", () => {
  const text = rules();
  assert.ok(text.includes("応答コードだけで判断しないこと"), "落とし穴を書いていない");
  assert.ok(text.includes("curl -sS -D -"), "確かめ方が具体的でない");
  assert.ok(text.includes("飛び先が認証の入口"), "どう読むかを書いていない");
});
