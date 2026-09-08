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
import { brokenEmphasis, headerlessTables } from "../src/emphasis.js";
import { OPERATIONS as TELEMETRY_OPS } from "../src/telemetryCli.js";
import { OPERATIONS as TRACKER_OPS } from "../src/trackerCli.js";
import { tempDir } from "./helpers/tmp.js";

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
  // **節の区切りが効いていなかった。** 英語版で `## 関連ファイル` を探しており、
  // 見つからないまま全文を見ていた（README を英語にしたときに置き去りになった）。
  // 節で区切れていないと、他の節が肩代わりして通る。
  for (const { file, usage } of [
    { file: "README.md", usage: ["## Usage", "## What gets placed"] },
    { file: "README.ja.md", usage: ["## 使い方", "## 関連ファイル"] },
  ]) {
    const text = readFileSync(join(KIT, file), "utf8");
    const [from, to] = usage.map((h) => text.indexOf(h));
    assert.ok(from !== -1 && to > from, `${file}: 使い方の節を切り出せない（${usage.join(" / ")}）`);
    const section = text.slice(from, to);

    const calls = invocations(section);
    assert.ok(calls.length > 0, `${file}: 使い方に、打つ形が1つも無い`);

    // **人が打つのは init と apply だけ。** update はプロジェクトの追跡ファイルを
    // 書き換える変更であり、作業単位にしてAIが行う（AUT-150）。人が既定ブランチで
    // 打って直接コミットすると、そのプロジェクト自身の規約を破る。
    for (const c of calls) {
      assert.ok(
        c.command === "init" || c.command === "apply",
        `${file}: 使い方に、人が打たないものが打つ形で出ている: ${c.command}`,
      );
    }
    // **表も見る。** 打つ形だけを見ていると、表に1行足されたことに気づけない。
    // 人が最初に読むのは表であり、**そこに並んでいれば打つものだと読まれる。**
    const listed = [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
    assert.deepEqual(
      listed.sort(),
      ["apply", "init"],
      `${file}: 使い方の表に並んでいるものが違う`,
    );
  }
});

// **人が打たないことを、書いてあること。** 消しただけだと、読んだ人は
// `update` の存在を知らないまま、どこかで見つけて打つ。
test("道具の入れ替えは、人が打つものではないと書いてある", () => {
  for (const [file, phrase] of [
    ["README.md", /Do not run `update` yourself/],
    ["README.ja.md", /人が直接 `update` を打たないこと/],
  ]) {
    assert.match(readFileSync(join(KIT, file), "utf8"), phrase, `${file}: 断っていない`);
  }
  // **手順は配布物にも要る。** AIが読むのはそちらである。
  const rules = readFileSync(join(KIT, "templates", "autodrive.md"), "utf8");
  const at = rules.indexOf("## autodrive-dev-kit を更新する");
  assert.notEqual(at, -1, "配布物に手順が無い");
  const section = rules.slice(at, rules.indexOf("\n## ", at + 1));
  for (const [pattern, what] of [
    [/作業単位にして/, "作業単位にすること"],
    [/既定ブランチで打って直接コミットしないこと/, "直接コミットしないこと"],
    [/止まったら、人へ返す/, "止まったときの扱い"],
    [/\.env\.example/, "資格情報が増える場合"],
  ]) {
    assert.match(section, pattern, `配布物の手順に、${what}が無い`);
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
  const { mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const root = tempDir("autodrive-readme-");
  mkdirSync(join(root, ".git"), { recursive: true });
  const placed = setup("init", root, KIT, useRecommended).placed.map((p) => p.path);

  // **両方の README で見る。** 片方だけ見ると、もう片方が黙って古くなる。
  for (const { file, section } of READMES) {
    const listed = [...section().matchAll(/^\| `([^`]+)` \| init \|/gm)].map((m) => m[1]);
    assert.ok(listed.length > 0, `${file}: init で置かれるものの一覧を拾えていない`);

    for (const path of listed) {
      assert.ok(placed.includes(path), `${file} に載っているが置かれない: ${path}`);
    }
    for (const path of placed) {
      assert.ok(listed.includes(path), `置かれるのに ${file} に無い: ${path}`);
    }
  }
});

// **生成しないものが、生成しないままであること。** 雛形を置くと中身が無いまま残る。
test("後から作られると書いたものは、init では作られない", async () => {
  const { setup } = await import("../src/setup.js");
  const { useRecommended } = await import("../src/ports/interview.js");
  const { existsSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const root = tempDir("autodrive-later-");
  mkdirSync(join(root, ".git"), { recursive: true });
  setup("init", root, KIT, useRecommended);

  const later = READMES.flatMap(({ section }) =>
    [...section().matchAll(/^\| `([^`]+)` \| (?!init \|)[^|]+\|/gm)].map((m) => m[1]),
  );
  assert.ok(later.length > 0, "後から作られるものの一覧を拾えていない");

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

// **見出しの無い表は、空の帯が出て崩れて見える。** 書いている側は本文だけを見て
// いるので気づかない。人から指摘されるまで気づかなかった（AUT-135）。
test("表に見出しがある", () => {
  const bad = [];
  for (const doc of documents()) {
    for (const t of headerlessTables(readFileSync(doc, "utf8"))) {
      bad.push(`${doc.slice(KIT.length + 1)}:${t.line}`);
    }
  }
  assert.deepEqual(bad, [], `見出しの無い表がある:\n${bad.join("\n")}`);
});

// **判定が本当に見つけられること。** 空の配列は、見ていなくても出る。
test("見出しの無い表を、実際に見つける", () => {
  assert.equal(headerlessTables("| | |\n|---|---|\n| a | b |").length, 1);
  assert.equal(headerlessTables("| 見出し | |\n|---|---|\n| a | b |").length, 0, "片方でもあれば帯は出る");
  assert.equal(headerlessTables("| a | b |\n|---|---|\n| 1 | 2 |").length, 0, "誤検出している");
  assert.equal(headerlessTables("ふつうの文\nもう1行").length, 0, "表でない行を拾っている");
});

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
  for (const { file, start, noSetup } of READMES) {
    assert.ok(start().includes("npx"), `${file}: clone せずに打てる形が書かれていない`);
    assert.ok(start().includes(noSetup), `${file}: ${start().slice(0, 200)}`);
  }
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
/**
 * 2つの README。**見出しが言語ごとに違うので、対応を表で持つ。**
 *
 * 英語を正とし、日本語も残す（AUT-135）。**「両方持たない」の理由は、実装が従う
 * ものと人が読むものの食い違いである。README は何も実行しないため、その危険が無い。**
 * ただし黙ってずれさせない。中身は両方で見る。
 */
const READMES = [
  {
    file: "README.md",
    text: () => readFileSync(join(KIT, "README.md"), "utf8"),
    section: () => {
      const t = readFileSync(join(KIT, "README.md"), "utf8");
      return t.slice(t.indexOf("## What gets placed"), t.indexOf("## How it fits together"));
    },
    start: () => {
      const t = readFileSync(join(KIT, "README.md"), "utf8");
      return t.slice(t.indexOf("### Getting started"), t.indexOf("### How development goes"));
    },
    noSetup: "No clone, no PATH setup",
  },
  {
    file: "README.ja.md",
    text: () => readFileSync(join(KIT, "README.ja.md"), "utf8"),
    section: () => {
      const t = readFileSync(join(KIT, "README.ja.md"), "utf8");
      return t.slice(t.indexOf("## 関連ファイル"), t.indexOf("## 仕組み"));
    },
    start: () => {
      const t = readFileSync(join(KIT, "README.ja.md"), "utf8");
      return t.slice(t.indexOf("### はじめ方"), t.indexOf("### 開発の進め方"));
    },
    noSetup: "clone も PATH の設定も要らない",
  },
];

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

// --------------------------- 出口制限の限界（AUT-122）

test("配布物が、出口制限を通信の遮断として書いていない", () => {
  const text = rules();
  assert.equal(text.includes("許可した宛先へしか出られない"), false, "嘘が残っている");
  assert.ok(text.includes("出口制限は、通信を遮断する仕組みではない"), "限界を書いていない");
});

// **弱めて出口制限で補う、をさせない。** そこが一番危ない読み方である。
test("本当に守っているものを挙げ、補えないと書く", () => {
  const text = rules();
  assert.ok(text.includes("手元に資格情報を置かないこと"), "何が守っているかが無い");
  assert.ok(text.includes("補えない"), "補えないと言っていない");
});

// ------------------------- 作業場の定義は、プロジェクトのもの（AUT-157）

// **触ってよいことと、誰のものかが配ってあること。** 分からなければ、結局こちらへ
// 聞きに来る。
test("作業場の定義を直接編集してよいと、配ってある", () => {
  const text = rules();
  assert.ok(text.includes("直接編集してよい"), "触ってよいと言っていない");
  assert.ok(text.includes("devcontainer.json"), "どのファイルかが無い");
  // **kit のものと混ぜない。** 隔離のロジックは手で変えるものではない。
  assert.ok(text.includes("init-firewall.sh"), "kit が持つものを挙げていない");
});

// **外すと隔離が消える行を、触ってよいと言う場所と同じところに書く。** 別の場所だと
// 読まれない。
test("外してはいけない行が、同じ場所に書いてある", () => {
  const text = rules();
  for (const must of ["runArgs", "postStartCommand", "remoteUser", "NET_ADMIN"]) {
    assert.ok(text.includes(must), `${must} が書かれていない`);
  }
  // **判定が見ていることまで言う。** 外したら落ちると分かる。
  assert.ok(text.includes("invariants"), "判定が見ていることを言っていない");
  // **AUT-121 の形を名指しする。** ここが唯一、指紋では捕まらなかった壊れ方である。
  assert.ok(text.includes("postCreateCommand"), "移してはいけない先を言っていない");
  assert.ok(text.includes("AUT-121"), "実際に起きたことを指していない");
});

// **足すと穴が開くことを、足し方と同じ場所に書く。** 別の場所だと読まれない。
test("中でコンテナを動かすと出口制限を迂回することを、警告している", () => {
  const text = rules();
  assert.ok(text.includes("出口制限を迂回する"), "迂回することを言っていない");
  assert.ok(text.includes("FORWARD"), "どこが絞られていないかを言っていない");
});

// ------------------------- 言い換えの基準（AUT-134）

// **これが無いと、決まった置き換えの無い語をその場で作ってしまう。**
test("言い換えてよい範囲が配ってある", () => {
  const text = rules();
  assert.ok(text.includes("置き換えてよいのは、定義が定めた語だけ"), "基準が無い");
  assert.ok(text.includes("一般に通じる語をそのまま使う"), "定めが無いときの指針が無い");
});

test("同じ語で2つを指さない、と書いてある", () => {
  const text = rules();
  assert.ok(text.includes("同じ語で2つのものを指さない"), "書いていない");
  assert.ok(text.includes("間違いのもと"), "なぜ悪いかを書いていない");
});

// **避ける対象を取り違えない。** 実装名と、一般語は違う。
test("避けるのは実装名であって一般語ではない、と書いてある", () => {
  assert.ok(rules().includes("避けるのは実装名"), "取り違えを塞いでいない");
});

// ------------------------------------- 2つの README がずれない（AUT-135）

/** 見出しの深さの並び。**言語が違っても、構造は同じであること。** */
const outline = (text) =>
  [...text.matchAll(/^(#{1,4}) /gm)].map((m) => m[1].length);

/** 指しているもの。**片方だけリンクが増減したら、内容がずれている。** */
const links = (text) =>
  [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]).filter((l) => !l.startsWith("http"));

// **英語を正とし、日本語も残す。** README は何も実行しないので、食い違っても
// 危険ではない。ただし黙ってずれると、片方だけ古いことに誰も気づかない。
test("2つの README の構造が揃っている", () => {
  const [en, ja] = READMES.map((r) => r.text());
  assert.deepEqual(
    outline(en),
    outline(ja),
    "見出しの数か深さが違う。片方に節が増えたか減っている",
  );
});

test("2つの README が、同じものを指している", () => {
  const [en, ja] = READMES.map((r) => r.text());
  const only = (a, b) => a.filter((l) => !b.includes(l));
  // 互いを指すリンクだけは、当然ながら違う。
  const drop = (ls) => ls.filter((l) => l !== "README.md" && l !== "README.ja.md");
  assert.deepEqual(only(drop(links(en)), drop(links(ja))), [], "英語版にだけあるリンク");
  assert.deepEqual(only(drop(links(ja)), drop(links(en))), [], "日本語版にだけあるリンク");
});

// **英語の読み手を、日本語の文書の前で放置しない。**
test("日本語の文書しか無いことを、英語版が断っている", () => {
  const en = READMES[0].text();
  assert.ok(en.includes("written in Japanese"), "日本語であることを言っていない");
  assert.ok(en.includes("in your language"), "どうすればよいかを言っていない");
});

test("互いを指している", () => {
  assert.ok(READMES[0].text().includes("README.ja.md"), "英語版から日本語版へ行けない");
  assert.ok(READMES[1].text().includes("README.md"), "日本語版から英語版へ行けない");
});

// **載せる出力は、実物であること。** 無い出力を載せると、読んだ人が信じる。
test("英語版が載せている判定の出力が、実物と同じ形をしている", async () => {
  // **判定が使う印を、そのまま引く。** 手で写すと、変わったときに気づけない。
  // 言語ごとに綴りが違うため、全部の言語から集める。
  const { LANGUAGES, say } = await import("../src/messages.js");
  const real = LANGUAGES.flatMap((l) =>
    ["state.active", "state.substituted", "state.unsubstituted", "state.notInScope"].map((k) =>
      say(l, k),
    ),
  );

  for (const { file, text } of READMES) {
    // **リンクを拾わない。** `[名前](先)` は行頭にも出る。
    const inReadme = [...text().matchAll(/^\[([^\]]+)\](?!\()/gm)].map((m) => m[1]);
    assert.ok(inReadme.length > 0, `${file}: 出力例が載っていない`);
    for (const m of inReadme) {
      assert.ok(real.includes(m), `${file}: 実物に無い印を載せている: [${m}]`);
    }
  }
});

// 構築例の図が、枠からはみ出していないこと。
//
// **図には目視以外の確かめ方が無い。** SVG は座標で書いてあるため、文字が枠を
// 越えても、枠どうしが重なっても、開くまで分からない。開ける環境が無いところで
// 直すこともある（実際にこれを書いたときがそうだった）。
//
// **座標なら機械で見られる。** 見るのは収まっているかどうかまでで、読みやすいか
// までは見ない。
test("構築例の図が、枠からはみ出さない", () => {
  const svg = readFileSync(join(KIT, "docs", "environment.svg"), "utf8");
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert.notEqual(vb, null, "viewBox が読めない");
  const [W, H] = [Number(vb[1]), Number(vb[2])];

  const rects = [...svg.matchAll(/<rect([^>]*?)\/>/g)].map((m) => {
    const at = (k) => Number((new RegExp(`${k}="([-\\d.]+)"`).exec(m[1]) || [])[1]);
    return {
      x: at("x"), y: at("y"), w: at("width"), h: at("height"),
      // 下地。判定の対象にしない
      background: /class="bg"/.test(m[1]),
      // 中に枠を持つ入れ物。**大きさではなく class と破線で見分ける。**
      holder: /dasharray|class="bx holder"/.test(m[1]),
    };
  });
  assert.ok(rects.length > 5, "枠を読み取れていない。判定が空回りしている");

  for (const r of rects) {
    assert.ok(
      r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H,
      `枠が画面の外にある: ${r.x},${r.y} ${r.w}x${r.h}`,
    );
  }

  // 入れ物は中に枠を持つため、重なりの判定から外す。
  const solid = rects.filter((r) => !r.background && !r.holder);
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const [a, b] = [solid[i], solid[j]];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(overlap, false, `枠が重なっている: (${a.x},${a.y}) と (${b.x},${b.y})`);
    }
  }

  // 文字幅は描いてみないと確定しないため、**多めに見積もる。**
  // 日本語は全角、英数は 0.55 倍。これで収まらないものは、実際にも危うい。
  const widthOf = (t, size) =>
    [...t].reduce((n, c) => n + (/[\x20-\x7e]/.test(c) ? size * 0.55 : size), 0);
  const texts = [...svg.matchAll(/<text class="(\w+)"[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*>([^<]*)</g)];
  assert.ok(texts.length > 20, "文字を読み取れていない。判定が空回りしている");

  for (const [, cls, xs, ys, body] of texts) {
    if (cls === "grp") continue; // 区画の見出しは枠の外に置く
    const size = cls === "ttl" ? 15 : cls === "tag" ? 10.5 : 12;
    const [x, y] = [Number(xs), Number(ys)];
    // **いちばん小さい枠で見る。** 入れ物のほうで見ると、内側の枠の幅を見逃す。
    // 入れ物の直下に置いた文字もあるため、入れ物も候補に含める。
    const home = rects
      .filter((r) => !r.background)
      .filter((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const right = x + widthOf(body, size);
    if (home === undefined) {
      assert.ok(right <= W, `画面からはみ出す文字: ${body}`);
      continue;
    }
    assert.ok(right <= home.x + home.w - 12, `枠からはみ出す文字: ${body}`);
  }
});

// 図が、配布物より強い主張をしないこと。
//
// **図は短くする力が働くため、限界の但し書きが落ちやすい。** 実際に落とした。
// 初版は出口制限を「エージェントはこれを書き換えられない」と書いていたが、
// **エージェントはパスワード無しの root を持っており、書き換えられる**（AUT-146）。
//
// 配布物は「出口制限は、閉じる仕掛けではない」と書き、判定器も §9 の
// 「AIがこれらを無効化できないこと」を**代替**と報告している。
// **図だけが有効であるかのように見せていた。**
test("図が、出口制限を閉じる仕掛けとして見せない", () => {
  const svg = readFileSync(join(KIT, "docs", "environment.svg"), "utf8");
  assert.ok(svg.includes("GUARDRAIL"), "図の該当箇所が読めていない。判定が空回りしている");

  assert.equal(svg.includes("書き換えられない"), false, "**嘘が残っている**");
  assert.ok(svg.includes("閉じる仕掛けではない"), "限界を書いていない");
  // 規約であって強制ではないことまで言う。**言わないと、有効だと読まれる。**
  assert.ok(svg.includes("機械的な強制ではない"), "規約と強制の区別が無い");
});

/**
 * タグの対応を見る。**XML の検証器はこの環境に無い。**
 *
 * 開始と終了、自己終了だけを数える。属性の中身までは見ない。
 * **入れ子が壊れているかどうかが分かれば足りる。**
 */
function unbalancedTags(xml) {
  const body = xml.replace(/<!--[\s\S]*?-->/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (selfClosing === "/") continue;
    if (closing === "/") {
      if (stack.pop() !== name) return `${name} の閉じ方が合っていない`;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0 ? null : `閉じていない: ${stack.join(" > ")}`;
}

// 図が、そもそも描かれること。
//
// **SVG は壊れていると、何も出ずに終わる。** 崩れて出るのではなく、出ない。
// README に埋め込んだため、壊れれば「仕組み」の節が丸ごと空になる。
test("図が、組み立てとして壊れていない", () => {
  const svg = readFileSync(join(KIT, "docs", "environment.svg"), "utf8");
  assert.equal(unbalancedTags(svg), null);
  assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/m, "名前空間が無い");
  // README から画像として読まれるため、単体で完結していること。
  assert.equal(/<(script|foreignObject)\b/.test(svg), false, "画像として読まれない要素がある");
});

test("壊れた組み立てを、実際に見つける", () => {
  // **「壊れていない」を主張する判定は、壊れを見つけられなくても通る。**
  assert.notEqual(unbalancedTags("<svg><g></svg>"), null, "閉じ忘れを見逃している");
  assert.notEqual(unbalancedTags("<svg><g></rect></g></svg>"), null, "食い違いを見逃している");
  assert.equal(unbalancedTags('<svg><rect x="1"/><g></g></svg>'), null, "正しいものを落としている");
});

// ------------------------- 受け取る側から読めること（AUT-149）

// 英語版に日本語を混ぜないこと。
//
// **訳語の対応を括弧で添えていた**（`**active** (有効)`）。`language` を en に
// すれば判定器は `active` と出すため、英語の読者には用が無い。
//
// 残してよいのは2つだけ。日本語版への案内（日本語で書かないと気づかれない）と、
// 設定が実際に表示する選択肢である。
test("英語版に、日本語が紛れていない", () => {
  const lines = READMES[0].text().split("\n");
  const allowed = [/README\.ja\.md/, /\(日本語 \/ English\)/];
  const stray = lines
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /[぀-ヿ一-鿿]/.test(line))
    .filter(({ line }) => !allowed.some((ok) => ok.test(line)));
  assert.deepEqual(stray, [], stray.map((s) => `${s.no}: ${s.line}`).join("\n"));
});

// ライセンスの節が、何をしてよいかを言うこと。
//
// **名前と著作権表示だけでは、読んだ人が使ってよいか判断できない。** 躊躇させる。
// 言うべきは「自由に使える」「残すのは2つだけ」「init が置くので普通は何も要らない」。
test("ライセンスの節が、何をしてよいかを言う", () => {
  for (const readme of READMES) {
    const text = readme.text();
    assert.match(text, /LICENSE/, `${readme.file}: 対象のファイル名が無い`);
    assert.match(text, /NOTICE/, `${readme.file}: 対象のファイル名が無い`);
    assert.match(text, /autodrive\//, `${readme.file}: どこへ置かれるかが無い`);
  }
  // **やってよいことを、先に言う。** 条件から書くと、条件のほうが主に読める。
  //
  // **言い回しではなく、言えているかで見る。** 文面は変わるが、
  // 「自由に使ってよい」「商用も含む」の2つは落としてはいけない。
  for (const [readme, heading, grants] of [
    // **隣の段落が肩代わりしないものを選ぶ。** 「自由」だけを見ると、
    // すぐ下にある定義の CC BY の説明が肩代わりして通ってしまう。
    [READMES[0], "## License", [/distribute/i, /modif/i, /\buse\b/i, /commercial/i]],
    [READMES[1], "## ライセンス", [/配布/, /改変/, /利用/, /商用/]],
  ]) {
    const text = readme.text();
    const at = text.indexOf(heading);
    assert.notEqual(at, -1, `${readme.file}: ライセンスの節が無い`);
    const section = text.slice(at, text.indexOf("\n## ", at + 1));
    for (const grant of grants) {
      assert.match(section, grant, `${readme.file}: 許諾の範囲が書かれていない（${grant}）`);
    }
  }
});

// フォークしたときに動かないものを、全部挙げること。
//
// **測って3つある。** どれも「この作業場に固有」であり、黙っていると
// フォークした人が原因の分からない失敗を踏む。
test("フォークの節が、動かないものを挙げている", () => {
  // **節の中だけを見る。** 全文で見ると、他の節に同じ語があるだけで通ってしまう。
  // 実際に `mutations/regression.json` は「dev-kit そのものを直す」にも出るため、
  // フォークの節から落としても気づけなかった。
  for (const [readme, heading] of [[READMES[0], "## Forking"], [READMES[1], "## フォークする"]]) {
    const text = readme.text();
    const at = text.indexOf(heading);
    assert.notEqual(at, -1, `${readme.file}: フォークの節が無い`);
    const section = text.slice(at);

    for (const [pattern, what] of [
      [/telemetry\/\*\.jsonl/, "記録"],
      [/`cross`/, "横断のジョブ"],
      [/mutations\/regression\.json/, "変異の一覧"],
      [/AUTODRIVE_CI_TOKEN/, "CI の資格情報"],
      [/NOTICE/, "著作権表示の足し方"],
    ]) {
      assert.match(section, pattern, `${readme.file} のフォークの節に、${what}への言及が無い`);
    }
  }
});
