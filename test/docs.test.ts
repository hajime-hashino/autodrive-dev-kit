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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { delegateFor, MODES } from "../src/cli.ts";
import { OPERATIONS as TELEMETRY_OPS } from "../src/telemetryCli.ts";
import { OPERATIONS as TRACKER_OPS } from "../src/trackerCli.ts";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 文書を集める。**追加された文書も勝手に対象になる。** 一覧を手で保つと、漏れる。 */
function documents(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
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
function invocations(body: string): Array<{ line: number; command: string; operation: string | null }> {
  const out: Array<{ line: number; command: string; operation: string | null }> = [];
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

interface Mention {
  doc: string;
  line: number;
  command: string;
  operation: string | null;
}

/** 文書から、打たれているコマンドを拾う。 */
function mentions(): Mention[] {
  const found: Mention[] = [];
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
  const known = (c: string) => MODES.has(c) || delegateFor(c) !== null;
  const seen = mentions();
  assert.ok(seen.length > 0, "コマンドの記載を1つも拾えていない。拾い方が壊れている");

  for (const m of seen) {
    assert.ok(known(m.command), `${m.doc}:${m.line} に無いコマンド: ${m.command}`);
  }
});

test("文書に載っている操作が実在する", () => {
  const table: Record<string, Record<string, unknown>> = {
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
  const { setup } = await import("../src/setup.ts");
  const { useRecommended } = await import("../src/ports/interview.ts");
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
  const { setup } = await import("../src/setup.ts");
  const { useRecommended } = await import("../src/ports/interview.ts");
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
