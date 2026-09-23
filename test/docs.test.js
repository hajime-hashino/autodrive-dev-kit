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
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { delegateFor, MODES } from "../src/vendored/internal/cli.js";
import { brokenEmphasis, headerlessTables } from "../src/vendored/internal/emphasis.js";
import { OPERATIONS as TELEMETRY_OPS } from "../src/vendored/internal/telemetryCli.js";
import { init, template } from "../src/vendored/internal/init.js";
import { OPERATIONS as TRACKER_OPS } from "../src/vendored/internal/trackerCli.js";
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
  walk(join(KIT, "src", "templates"));
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
    // テンプレートは複製先を `{{KIT}}/bin/` として持つため、前置きの経路は許す。
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
  for (const must of ["README.md", "docs/commands.md", "docs/design.md", "src/templates/autodrive.md"]) {
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
test("autodrive-dev-kit の入れ替えは、人が打つものではないと書いてある", () => {
  for (const [file, phrase] of [
    ["README.md", /Do not run `update` yourself/],
    ["README.ja.md", /人が直接 `update` を打たないこと/],
  ]) {
    assert.match(readFileSync(join(KIT, file), "utf8"), phrase, `${file}: 断っていない`);
  }
  // **手順は配布物にも要る。** AIが読むのはそちらである。
  // **分けたので、両方を見る。** 片方しか見ないと、移した先が空でも通る。
  const rules = ["autodrive.md", "autodrive-reference.md"]
    .map((f) => readFileSync(join(KIT, "src", "templates", f), "utf8"))
    .join("\n");
  // **置き場所に依らず見る。** 毎回読むほうに短い案内、引くほうに手順、という
  // 分け方をしている。**どちらに書いてあっても、配られていればよい**（AUT-196）。
  const sections = rules
    .split("\n## ")
    .filter((s) => s.startsWith("autodrive-dev-kit を更新する"));
  assert.notEqual(sections.length, 0, "配布物に手順が無い");
  const section = sections.join("\n");
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

// ------------------------------------------------------------ ADR の索引

// **索引が、リンク先と食い違っていないこと。**
//
// 索引には「新しい ADR を追加したら、この索引に1行足す」と書いてあるが、
// **足したかどうかも、内容が合っているかも確かめる手段が無かった。** 実際に
// 0001 が改訂されたあと索引だけが古いまま残り、TypeScript と書き続けていた。
// 索引は「計画の冒頭でここを参照すること」と言っている場所であり、**最初に読む
// ところが実際とは逆のことを言っていた**（AUT-160）。
//
// **見出しで始まっているかだけを見る。** 索引が見出しより詳しいのは構わない。
// 曖昧な判断を入れると、判定そのものが信用されなくなる。
test("ADR の索引が、リンク先の見出しと合っている", () => {
  const dir = join(KIT, "docs", "adr");
  const index = readFileSync(join(dir, "README.md"), "utf8");
  const rows = [...index.matchAll(/^\| \[(\d+)\]\(([^)]+)\) \| (.+?) \|/gm)];
  assert.ok(rows.length > 0, "索引の行を拾えていない。拾い方が壊れている");

  // **数も合っていること。** 足し忘れも、消し忘れも、ここで出る。
  const files = readdirSync(dir).filter((n) => /^\d{4}-.+\.md$/.test(n)).sort();
  assert.deepEqual(rows.map((r) => r[2]).sort(), files, "索引と ADR が1対1になっていない");

  for (const [, num, link, judgment] of rows) {
    const title = readFileSync(join(dir, link), "utf8").split("\n")[0];
    const core = title.replace(/^#\s*ADR\s*\d+:\s*/, "").trim();
    assert.ok(
      judgment.startsWith(core),
      `索引の ${num} が見出しと違う:\n  索引   = ${judgment}\n  見出し = ${core}`,
    );
  }
});

// ------------------------------------------------------------ 置かれるものの一覧

// **README の一覧が、実際に置かれるものと一致すること。** 一覧は手で保たれており、
// 置くものを変えたときに追随しなかったことに気づく機会が無い。**初日に見る表が
// 間違っていると、そこで詰まる。**
test("README の一覧が、実際に置かれるものと一致する", async () => {
  // **人が打つ経路をそのまま使う。** 下位の関数を直に呼ぶと、そこでは置かれない
  // ものが表から漏れる（実際に autodrive.json で漏れた）。
  const { setup } = await import("../src/vendored/internal/setup.js");
  const { useRecommended } = await import("../src/vendored/internal/ports/interview.js");
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

// **生成しないものが、生成しないままであること。** テンプレートを置くと中身が無いまま残る。
test("後から作られると書いたものは、init では作られない", async () => {
  const { setup } = await import("../src/vendored/internal/setup.js");
  const { useRecommended } = await import("../src/vendored/internal/ports/interview.js");
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
  assert.equal(brokenEmphasis("**このバージョンで動く。** 参照実装を更新しても変わらない。").length, 0);
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

  // **Windows でも動く形であること。** シェルスクリプトだと npm がラッパーを作れない。
  const head = readFileSync(entry, "utf8").split("\n")[0];
  assert.equal(head, "#!/usr/bin/env node", `bin が node で始まっていない: ${head}`);
});

// **配るものを絞る。** テストも記録も、使う側には要らない。
test("配るものに、使う側が要らないものを含めない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  assert.ok(pkg.files, "files が宣言されていない");

  // **`src` の下に、配るものが全部入っている。** 殻も実装もテンプレートも
  // ここにあり、外に出ているのは配らないものだけである（AUT-202）。
  assert.ok(pkg.files.includes("src"), "src を配っていない");
  for (const unneeded of ["test", "telemetry", "docs"]) {
    assert.equal(pkg.files.includes(unneeded), false, `${unneeded} を配っている`);
  }
});

// **公開は固定条件である**（定義§9：外部への不可逆な公開）。下ごしらえだけを
// 済ませ、公開そのものは人が決める。private を外すのは、その判断の場である。
test("下ごしらえだけで、公開はしない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  assert.equal(pkg.private, true, "公開を止める設定が外れている。**これは人の判断を要する**");
});

// **判定できる形にしておく。** ここが緩むと、要るバージョンに届いていないことに気づけず
// 黙って落ちる。**確認そのものが型注釈を必要としてはいけない。**
test("要るバージョンに届いていなければ、断る", async () => {
  const { NEEDS, tooOld, tooOldMessage } = await import("../src/vendored/bin/node-version.js");

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

// **確認の手前で落ちない形であること。** 入口が型注釈を含むと、要るバージョンに届いて
// いない人には、確認そのものが動かない。
test("入口だけは、型注釈を使わない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"))

   ;
  for (const file of [pkg.bin["autodrive-dev-kit"], "src/vendored/bin/node-version.js"]) {
    const body = readFileSync(join(KIT, file), "utf8");
    for (const typed of [": string", ": number", "as const", "interface ", "import type"]) {
      assert.equal(body.includes(typed), false, `${file} に型注釈がある: ${typed}`);
    }
  }

  // **確認が入口に繋がっていること。** 関数があっても、呼ばれなければ意味がない。
  // ここだけは中身を読んで確かめる。**古い Node を用意して動かすことができない**
  // ため、他に確かめる手段が無い。
  const entry = readFileSync(join(KIT, pkg.bin["autodrive-dev-kit"]), "utf8");
  assert.ok(entry.includes("tooOld(process.versions.node)"), "入口がバージョンを確かめていない");

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

// **配られるものを全部見る。** どのファイルに書いてあるかではなく、**配られて
// いるか**を判定する。分けたときに、判定まで片方しか見なくなるのを避ける（AUT-196）。
const rules = () =>
  ["autodrive.md", "autodrive-reference.md"]
    .map((f) => readFileSync(join(KIT, "src", "templates", f), "utf8"))
    .join("\n")
    .replace(/\n/g, "");

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

// **配布物は、仕組みそのものを配らない**（AUT-205）。プレビューが検証環境の上に
// 出るのは、この参照実装が Cloudflare Workers で組んだ結果であって、一般の決まり
// ではない。**プロジェクトによって、ローカル・プレビューURL・専用環境のどれにもなる。**
//
// **配るのは、確かめ方のほうである。** AUT-125 で起きたのは「プレビューを見ている
// つもりで検証環境を見ていた」であり、防ぐのは仕組みの知識ではなく、読んで確かめる
// 習慣である。
test("配布物が、一つの構成の仕組みを決まりとして配らない", () => {
  const text = rules();
  assert.equal(
    text.includes("プレビューは検証環境の上に出る"),
    false,
    "一つの構成の仕組みを、決まりとして配っている",
  );
  // **構成を読むことは、文書の冒頭で一度だけ言う。** 節ごとに繰り返さない。
  assert.ok(text.includes("推測しないで、そこを読むこと"), "構成を読ませていない");
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

// ------------------------- サンドボックスの定義は、プロジェクトのもの（AUT-157）

// **触ってよいことと、誰のものかが配ってあること。** 分からなければ、結局こちらへ
// 聞きに来る。
test("サンドボックスの定義を直接編集してよいと、配ってある", () => {
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
  // **移してはいけない先を名指しする。** ここが唯一、指紋では捕まらなかった壊れ方である。
  assert.ok(text.includes("postCreateCommand"), "移してはいけない先を言っていない");
  // **どう壊れるかを書く。** 番号では言わない。配られた先から見ると、開けない
  // 別のワークスペースの番号であり、意味が取れない（人の指摘）。
  //
  // **過去の報告としても書かない**（AUT-205）。「実際にそうなっていた。10日間、誰も
  // 気づかなかった」と書いていたが、配られた先の読み手はこれから入れる人であり、
  // **道具が壊れていたと読める。** 起きたのはこの作業場の開発中である。
  //
  // **そして、いまは気づけないが誤りである。** `isolation.js` が postCreateCommand への
  // 移動を名指しで検出する。捕まえられるものを「気づけない」と書かない。
  assert.ok(text.includes("2回目以降の起動で隔離が無くなる"), "どう壊れるかを言っていない");
  assert.ok(text.includes("気づけるのは判定のほうである"), "何が捕まえるのかを言っていない");
  assert.equal(text.includes("誰も気づかなかった"), false, "過去の報告として書いている");
});

// **足すと穴が開くことを、足し方と同じ場所に書く。** 別の場所だと読まれない。
test("中でコンテナを動かすと出口制限を迂回することを、警告している", () => {
  const text = rules();
  assert.ok(text.includes("出口制限を迂回する"), "迂回することを言っていない");
  assert.ok(text.includes("FORWARD"), "どこが絞られていないかを言っていない");
});

// ------------------------- 言い換えの基準は、もう配っていない（AUT-205）
//
// **人の判断で「語を作らない」を配布物から落とした。** 鍵・印・枝・引き金という
// 造語が出た経緯があり（AUT-134 / AUT-163）、その抑止は配られなくなっている。
//
// **参照実装自身の文書に対する判定は残している**（「参照実装の文書が、言い換えた語を
// 使っていない」）。作る側の規約としては続く。

// ------------------- 作る側の規約を、配る側に混ぜない（AUT-163）
//
// **ポートの語で書くのは、参照実装を作るときの規約である**（`docs/commands.md`）。
// 利用する側では向け先が固定されており、守る対象ではない。差し替えたくなったら、
// そのプロジェクトの中で移行して ADR に残せばよい。
//
// 配布物はこれを言い直したうえで「文書も」と広げていた。**広げた読み方が造語を
// 生んでいた**（「実装の言葉を使わない」→「カタカナを避ける」→ 枝）。**補強では
// なく、混ぜたのをやめる。**
test("配る規約が、書き方の規約としてポート語彙を配らない", () => {
  const text = rules();
  for (const spread of [
    "動くものは、ポート語彙で書く",
    "手順も文書も、定義§16のポート語彙で書く",
    "実装名を直接扱ってよいのはアダプタ層のみ",
  ]) {
    assert.equal(text.includes(spread), false, `作る側の規約が配られている: ${spread}`);
  }
  // **ポートの一覧そのものは残す。** コマンドの名前がその語でできている。
  assert.ok(text.includes("| Tracker |"), "ポートの一覧まで消えている");
  assert.ok(text.includes("autodrive.json"), "どこを見れば実装が分かるかが無い");
});

// **作る側の規約は、作る側の文書にある。** 消したのではなく、混ぜるのをやめただけ。
test("差し替えられる形の規約は、参照実装の文書にある", () => {
  const commands = readFileSync(join(KIT, "docs", "commands.md"), "utf8");
  assert.ok(commands.includes("呼び出し側は実装名を知らない"), "作る側の規約が無い");
  assert.ok(commands.includes("src/adapters/"), "どこを置き換えるのかが無い");
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
  // **判定が使う目印を、そのまま引く。** 手で写すと、変わったときに気づけない。
  // 言語ごとに綴りが違うため、全部の言語から集める。
  const { LANGUAGES, say } = await import("../src/vendored/internal/messages.js");
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
      assert.ok(real.includes(m), `${file}: 実物に無い目印を載せている: [${m}]`);
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
// 配布物は「出口制限は、閉じる仕掛けではない」と書き、`invariants` も §9 の
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
// すれば`invariants` は `active` と出すため、英語の読者には用が無い。
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
// **測って3つある。** どれも「このワークディレクトリに固有」であり、黙っていると
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

// ------------------- 規約が在ることと、守られていることは違う（AUT-194）
//
// **上の判定は「カタカナを避けない、と書いてあるか」しか見ていない。** 文書が
// 実際にその語を使っているかは、誰も見ていなかった。だから **ADR 0008 の題名が
// 「トークン消費は枝に載せず」のまま通った。**
//
// **見るのは「枝」だけにする。** 「鍵」には正当な用例がある（SSH の公開鍵・
// 秘密鍵は日本語でそう呼ぶ）。一律に禁じると**誤って出る警告**になり、本物の
// 警告を隠す。同じ型を何度も踏んでいる（AUT-168 / AUT-169）。
test("参照実装の文書が、言い換えた語を使っていない", () => {
  // **悪い例として引いている箇所は除く。** 直すと規約が読めなくなる。
  const quoting = ["templates/autodrive.md", "test/docs.test.js"];
  const found = [];

  const walk = (dir) => {
    for (const entry of readdirSync(join(KIT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.(md|js)$/.test(entry.name)) continue;
      if (quoting.some((q) => rel.endsWith(q))) continue;
      for (const [n, line] of readFileSync(join(KIT, rel), "utf8").split("\n").entries()) {
        if (line.includes("枝")) found.push(`${rel}:${n + 1}  ${line.trim().slice(0, 60)}`);
      }
    }
  };
  for (const dir of ["docs", "src"]) walk(dir);

  assert.deepEqual(found, [], `「枝」を使っている。「ブランチ」と書くこと:\n${found.join("\n")}`);
});

// **配られた先に、こちら側の語を持ち込まない**（AUT-194）。
//
// 「参照実装」は、**これを作っている側から見た呼び名**である。配られた先にあるのは
// `autodrive-dev-kit` という名前の道具だけで、**そこから見ると意味が取れない。**
//
// しかも配布物は6行目で「autodrive-dev-kit は {{KIT}}/ にある」と名乗ったうえで、
// **同じものを7箇所で「参照実装」と呼んでいた。** 名前のあるものを言い換えている。
test("配布物が、作る側の呼び名を持ち込まない", () => {
  const text = rules();
  assert.equal(text.includes("参照実装"), false, "作る側の呼び名が配られている");
  // **名前は残す。** どこへ起票すればよいかが消えると、直す先が分からなくなる。
  assert.ok(text.includes("autodrive-dev-kit"), "道具の名前が無い");
});

// ------------------- 毎回読ませる量を、伸びるに任せない（AUT-196）
//
// **長さそのものが欠陥である。** 毎回読ませる量が、そのまま作業に使える余地を削る。
// 分ける前は 634 行あり、**定義（611行）より長かった。** そして 41 の見出しのどこに
// 何があるかを、書いた側も把握できていなかった（AUT-194 で2つの違反が出た）。
//
// **この数字は聖域ではない。** 超えたら落とすためではなく、**超えたときに「引く
// ほうへ移せないか」を考える機会を作るため**に置いている。移せないなら上げてよい。
test("毎回読ませるほうが、際限なく伸びていない", () => {
  const core = readFileSync(join(KIT, "src", "templates", "autodrive.md"), "utf8").split("\n").length;
  const limit = 450;
  assert.ok(
    core <= limit,
    `毎回読むほうが ${core} 行ある（目安 ${limit}）。` +
      "引くほうへ移せないかを考えること。移せないなら、この目安を上げてよい",
  );
});

// **分けたことが、分かる形で配られていること。**
test("毎回読むものと、引くものの関係が配ってある", () => {
  const core = readFileSync(join(KIT, "src", "templates", "autodrive.md"), "utf8");
  const ref = readFileSync(join(KIT, "src", "templates", "autodrive-reference.md"), "utf8");
  // **冒頭で案内していること。** 本文のどこかに出てくるだけでは足りない。
  // 引っかかる前に「引く先がある」と知らせるのが、この案内の役目である。
  const head = core.split("\n").slice(0, 20).join("\n");
  assert.match(head, /autodrive-reference\.md/, "冒頭で引く先を案内していない");
  assert.match(ref, /毎回読まなくてよい/, "毎回読むものでないことが書かれていない");
  assert.match(ref, /autodrive\.md/, "戻る先が案内されていない");
});

// **開発の流れが配ってあること**（AUT-196）。
//
// **634 行あって、これが1行も無かった。** 「検証環境」で引くと出てくるのは露出の
// 話だけで、**検証環境で確かめてから本番へ出すという基本が規約に無かった。**
//
// 仕掛けのほうは動いていた（提出のたびに検証環境へ出ていた）。**しかし誰も見て
// いなくても本番へ進む。** 「仕掛けはあるが誰も見ない」は「無い」に近い。
//
// **言い方は「守ること」1箇所に寄せた**（AUT-205）。同じことを流れの説明でも
// 繰り返していたため、自明な分を落とした。**判定は、どこに書いてあるかではなく
// 配られているかを見る。**
test("検証環境を経てから本番へ出す、と配ってある", () => {
  const text = rules();
  for (const [pattern, what] of [
    [/検証環境で確かめてから統合する/, "確かめてから統合すること"],
    [/統合が本番への引き金である/, "統合が引き金であること"],
    [/不可逆/, "不可逆であること"],
  ]) {
    assert.match(text, pattern, `配っていない: ${what}`);
  }
});

// ------------------------------------------------- 品質管理の指示（AUT-210）
//
// **autodrive.md はAIの動きを縛るファイルである。** 捉え方を書いても動きは変わらない。
// 最初の版は「こう捉えよ」としか書いておらず、**読んでも何も変わらなかった**（人の指摘）。
//
// **ゴールは、歴戦のエンジニアでなくてもちゃんとした品質のアプリが作れること。**

// **観点と箇所が、先に並んでいること。** 何を見るかが決まらないと、手法は選べない。
test("品質の観点と、確認する箇所が配ってある", () => {
  const text = rules();
  for (const view of ["ビジネス目的の達成", "機能", "性能", "セキュリティ", "信頼性", "保守性"]) {
    assert.ok(text.includes(view), `観点が無い: ${view}`);
  }
  for (const where of ["静的", "単体", "結合", "システム", "受入", "本番監視"]) {
    assert.ok(text.includes(where), `確認する箇所が無い: ${where}`);
  }
});

// **プロセスの品質を、この軸に混ぜない。** ISO 25010 は製品品質だけを扱う規格であり、
// プロセス品質は別系統である。この手法では委譲範囲の表・テレメトリ・不変条件が担う。
// **混ぜると、どちらも中途半端になる。**
test("プロセスの品質は、この軸に含めないと書いてある", () => {
  const text = rules();
  assert.ok(text.includes("プロセスの品質は、ここに含めない"), "切り分けが書かれていない");
  assert.ok(text.includes("作ったものそのものである"), "何を見る軸なのかが書かれていない");
});

// **ベースラインが実物であること。** 「考えよ」では立ち上げで1から考えることになる。
test("ベースラインが、手法と範囲まで示されている", () => {
  const text = rules();
  assert.ok(text.includes("主要なビジネスケース"), "ビジネス目的の既定が無い");
  assert.ok(text.includes("依存の脆弱性検査"), "セキュリティの既定が無い");
  // **空けたものも示す。** 何を見ないかが書いていないと、全部見ていると読まれる。
  assert.ok(text.includes("既定では見ない"), "空けた観点が示されていない");
});

// **人に品質の知識を求めない。** 白紙で聞くと、非エンジニアは答えられない。
test("白紙で聞かず、案を出せと指示している", () => {
  const text = rules();
  assert.ok(text.includes("人に品質の知識を求めない"), "知識を求めるなと言っていない");
  assert.ok(text.includes("こちらが案を出し、人が選ぶ"), "案を出せと言っていない");
  assert.ok(
    text.includes("入れない場合に何が見られなくなるかを添える"),
    "欠ける範囲を添えることが書かれていない",
  );
});

// **実装の前に検出を作る。** 順番が逆だと、テストが実装に合わせて書かれる。
test("守ることが、動きの指示になっている", () => {
  const text = rules();
  assert.ok(text.includes("実装より先に検出を作る"), "順番の指示が無い");
  assert.ok(text.includes("戻せないものは、検出が無いまま通さない"), "通さないと言っていない");
  // **通ったのは書いたものだけである。**
  assert.ok(
    text.includes("確かめた手段と、誰も見ていない範囲を添える"),
    "提出に添えるものが書かれていない",
  );
});

// **手法は静的解析とテストだけではない**（人の指摘）。ただし毎回読む側に並べない。
// **長さはハルシネーションの元になる。** 一覧は引く側に置く。
test("手法の一覧が、引く側に配ってある", () => {
  const ref = readFileSync(join(KIT, "src", "templates", "autodrive-reference.md"), "utf8");
  for (const how of ["AIレビュー", "脅威モデリング", "契約テスト", "合成監視", "変異テスト"]) {
    assert.ok(ref.includes(how), `手法が無い: ${how}`);
  }
  // **人のレビューは委譲範囲を動かす。** 安いから入れる、とはならない。
  assert.ok(ref.includes("委譲範囲の表を動かす"), "人のレビューの扱いが書かれていない");
  // **毎回読む側には並べない。**
  const core = readFileSync(join(KIT, "src", "templates", "autodrive.md"), "utf8");
  assert.equal(core.includes("ファジング"), false, "毎回読む側に手法を並べている");
});

// **会話で決めて終わりにしない。** 置き場が無ければ、次の作業単位では読めない。
test("決めたことの置き場が、実体として配られる", () => {
  const body = template(KIT, "quality.md");
  // **手法と範囲まで書かせる。**「見ている」だけでは何も分からない（人の指摘）。
  assert.ok(body.includes("どこまで見ているか"), "範囲の欄が無い");
  assert.ok(body.includes("「どこまで」を省略しないこと"), "省略を禁じていない");
  assert.ok(body.includes("確認しないと決めたこと"), "意図して空けた記録の欄が無い");
  assert.ok(body.includes("戻せないもの"), "戻せないものの欄が無い");
  assert.ok(body.includes("空欄は「問題なし」と読まれる"), "空欄の読まれ方への注意が無い");

  const root = project();
  init(root, KIT);
  assert.ok(existsSync(join(root, "docs", "quality.md")), "docs/quality.md が置かれていない");
});

// **利用者に届くものと、作る場を、同じ表に並べない。** 並ぶと同じ重さで読まれるが、
// 壊れたときに損をする人が違う（人の指摘）。
test("雛形が、プロダクトと作る場を別の節に分けている", () => {
  const body = template(KIT, "quality.md");
  const product = body.indexOf("# プロダクトの品質");
  const place = body.indexOf("# 開発環境・開発プロセスの品質");

  assert.notEqual(product, -1, "プロダクトの節が無い");
  assert.notEqual(place, -1, "作る場の節が無い");
  // **順序が意味を持つ。** 重いほうを先に読ませる。
  assert.ok(product < place, "作る場がプロダクトより先に来ている");

  // サンドボックスは作る場の側にある。**プロダクトの表に混ざると重さを取り違える。**
  assert.ok(body.indexOf("## サンドボックス") > place, "サンドボックスがプロダクト側にある");
});

// **自動で見ているものが全部だと読まれる。** 人が担保する欄が無いと、そうなる。
test("雛形に、人が確認するものの欄がある", () => {
  const body = template(KIT, "quality.md");

  assert.ok(body.includes("人が確認するもの"), "人が担保する欄が無い");
  assert.ok(body.includes("定義§17"), "何が人の領域かの根拠が示されていない");
  // **知識不足を人の領域にしない。** 混ぜると、渡せば済むものまで戻る。
  assert.ok(
    body.includes("知識が足りないことは"),
    "渡せば済むものと、人が担保するものの境が書かれていない",
  );
});

// **「無い」と書いただけでは、次が起きない。** 穴が見えたまま残る。
test("手法が無い行に、行き先を求めている", () => {
  const body = template(KIT, "quality.md");
  assert.ok(body.includes("いつ見直すか、または作業単位のID"), "行き先を求めていない");
});

// **決める段が無いと、決めないまま進む。**
test("品質を決める段が、立ち上げにある", () => {
  const steps = readFileSync(join(KIT, "src", "templates", "autodrive.md"), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("| ") && l.includes("**"));
  const step = steps.find((l) => l.includes("品質で確認することを決めてもらう"));
  assert.ok(step !== undefined, `立ち上げの段取りに品質が無い:\n${steps.slice(0, 12).join("\n")}`);
  // **成果物はファイルである。** 会話で消えるものを成果物にしない。
  assert.ok(step.includes("docs/quality.md"), `成果物がファイルになっていない: ${step}`);
});

/** 素のリポジトリ。`init` が置けるだけの状態にする。 */
function project() {
  const root = tempDir("autodrive-docs-");
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  return root;
}

// **「受入」を、人がやることと読ませない**（人の確認）。この表はすべて自動で回す。
// **ビジネスケースを通すのは E2E であって、人ではない。** 人が見るのは抜き取り確認
// （定義§8）と、出口に残す場合の受け入れ確認（定義§10）であり、どちらも別物である。
test("品質の表が、すべて自動で回るものだと書いてある", () => {
  const text = rules();
  assert.ok(text.includes("この表は、すべて自動で回すものである"), "自動だと言っていない");
  assert.ok(
    text.includes("ビジネスケースを通すのは E2E であり、人ではない"),
    "誰が通すのかが書かれていない",
  );
  // **人が見るものは、別だと言う。** 言わないと、この表に混ぜて読まれる。
  assert.ok(text.includes("どちらもこの表には入らない"), "人が見るものとの切り分けが無い");
});

// **箇所と環境が繋がっていること**（人の確認）。テストレベルだけを並べても、
// どこで動かすかが決まらない。**「環境の考え方」と別々に置いていた。**
test("確認する箇所と、動かす環境が対応づけてある", () => {
  const text = rules();
  assert.ok(text.includes("どの環境で動かすかは、箇所で決まる"), "対応が書かれていない");
  // **システムと受入は検証環境。** 手元で通しても、本番に近い構成を確かめたことにならない。
  assert.match(text, /システム・受入 \| \*\*検証環境\*\*/, "システム・受入の環境が無い");
  // **手元で外部の実物を叩かない。**
  assert.ok(
    text.includes("外部サービスの実物が要る結合は、検証環境で行う"),
    "外部依存の扱いが書かれていない",
  );
});

// -------------------------------------------- 中断して戻る道が配ってある（AUT-206）
//
// **入口を通らずに戻ると、記録の紐づけ先が置き直されない。** 戻ったあとに書いた
// 記録が、前の作業単位へ向かう（AUT-221 と同じ形）。
test("中断して戻る道が、配ってある", () => {
  const text = rules();
  assert.ok(text.includes("中断して戻れる"), "戻れることが書かれていない");
  // **手で切り替えさせない。** 入口を通らない経路を残さない。
  assert.ok(
    text.includes("手で `git checkout` しないこと"),
    "手で切り替えるなと言っていない",
  );
  // **なぜかまで言う。** 理由が無いと、面倒なときに飛ばされる。
  assert.ok(
    text.includes("戻ったあとに書いた記録が、そちらへ向かう"),
    "手で切り替えると何が起きるかが書かれていない",
  );
  // **未コミットのまま戻さない。**
  assert.ok(text.includes("未コミットの変更があれば止まる"), "未コミットの扱いが無い");
});

// ---------------------------------- 人の発言を、そのまま引かない（AUT-228）
//
// **何を言われたかではなく、何が問題だったかを書く。** 発言はその場の言い方を
// 含む。後から読む人に要るのは提起の中身であって、言い回しではない。
//
// **過去の ADR は直さない。** 決定の記録であり、書き換えると、そのとき何を
// 決めたのかが読めなくなる。**これから書くものに適用する。**
test("ADR の書き方に、人の発言を引かないことが書いてある", () => {
  const body = readFileSync(join(KIT, "docs", "adr", "README.md"), "utf8");
  assert.ok(body.includes("人の発言を、そのまま引かない"), "規約が書かれていない");
  // **数と事実は引いてよい。** 論拠を丸めると根拠が弱まる。
  assert.ok(body.includes("数と事実は引いてよい"), "引いてよい範囲が書かれていない");
  // **過去は直さない。** 記録を書き換えない。
  assert.ok(body.includes("過去の ADR は直さない"), "過去の扱いが書かれていない");
});

// **決めた回の ADR 自身が、それを守っていること。** 守っていない規約は配らない。
test("この決定を書いた ADR が、人の発言を引いていない", () => {
  const body = readFileSync(
    join(KIT, "docs", "adr", "0011-applying-an-app-standard-to-a-tool.md"),
    "utf8",
  );
  const quotes = body.split("\n").filter((l) => l.startsWith("> "));
  assert.deepEqual(quotes, [], `発言を引いている:\n${quotes.join("\n")}`);
});

// ------------------------------------------------------------ 置き場所の名前

/**
 * **所有者の名前が、どこか1箇所だけ古いまま残る。**
 *
 * アカウント名が変わったとき、14箇所を手で直した（AUT-236）。**手で直す以上、
 * 1つ見落とす。** 見落としても静かに通り、リダイレクトが効いている間は誰も
 * 気づかない。**リダイレクトは、同名のリポジトリが作られると切れる。**
 *
 * URL が生きているかは見ない（通信になる）。**揃っているかだけを見る。** 揃って
 * いないことは、部分的に直した証拠である。
 */
test("GitHub の所有者の名前が、全部そろっている", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  const expected = /github\.com\/([^/]+)\//.exec(pkg.repository?.url ?? "")?.[1];
  assert.notEqual(expected, undefined, "package.json の repository から所有者を読めない");

  const odd = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      // **テストは見ない。** `o/r` のような作り物が入っており、拾うと誤検出になる。
      if (entry.name === "test") continue;
      // **変異の一覧も見ない。** 置換先に違う名前を書くのが仕事であり、拾うと
      // 必ず落ちる。**この一覧が実装と揃っているかは、置換元が実在するかの判定が
      // 見ている**（`mutate.test.js`）。
      if (entry.name === "regression.json") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(js|json|md|ya?ml)$/.test(entry.name)) continue;
      const body = readFileSync(path, "utf8");
      // `github:owner/repo` と `github.com/owner/repo` を拾う。
      // **`api.github.com/repos/...` は拾わない。** 所有者ではなく API の道である。
      for (const m of body.matchAll(/(?<!api\.)github(?::|\.com\/)([A-Za-z0-9-]+)\//g)) {
        if (m[1] !== expected) odd.push(`${relative(KIT, path)}  ${m[0]}`);
      }
    }
  };
  walk(KIT);

  assert.deepEqual(odd, [], `所有者の名前がそろっていない（package.json は ${expected}）`);
});
