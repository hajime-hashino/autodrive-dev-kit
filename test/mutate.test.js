/**
 * 変異を当てる仕掛けの判定。
 *
 * **この仕掛け自体が、確かめられていなかったものである**（AUT-138）。打ち方が
 * 間違っていて、何を変異させても「落ちた」と出ていた。**ここが一番、判定を
 * 要する場所である。**
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allCaught, applyOne, describe, mutate, runTests } from "../src/mutate.js";
import { tempDir } from "./helpers/tmp.js";

function project(body = "元の中身\n") {
  const root = tempDir("autodrive-mutate-t-");
  writeFileSync(join(root, "a.js"), body, "utf8");
  return root;
}

const m = (over = {}) => ({ name: "変異", file: "a.js", from: "元の中身", to: "壊した", ...over });

/** 中身が「壊した」なら落ちる、という作り物のテスト実行。 */
const fakeRun = (root) => !readFileSync(join(root, "a.js"), "utf8").includes("壊した");

// --------------------------------------------------- 当て方

test("捕まえたものと、通ったものを区別する", () => {
  const root = project();
  assert.equal(applyOne(root, m(), fakeRun).outcome, "caught");
  // テストが何も見ていない場合は、通ってしまう
  assert.equal(applyOne(root, m(), () => true).outcome, "survived");
});

// **必ず戻す。** 変異を残すと、次の変異の結果が読めない。
test("当てたあと、必ず元に戻す", () => {
  const root = project();
  applyOne(root, m(), fakeRun);
  assert.equal(readFileSync(join(root, "a.js"), "utf8"), "元の中身\n", "戻していない");
});

test("テストが落ちても、元に戻す", () => {
  const root = project();
  assert.throws(() => applyOne(root, m(), () => { throw new Error("実行が壊れた"); }));
  assert.equal(readFileSync(join(root, "a.js"), "utf8"), "元の中身\n", "戻していない");
});

// **当てられなかったものを、通ったことにしない。** 置換元が無ければ変異していない。
test("置換元が無ければ、捕まえたとも通ったとも言わない", () => {
  const root = project();
  const o = applyOne(root, m({ from: "無い文字列" }), fakeRun);
  assert.equal(o.outcome, "not-applied");
  assert.equal(allCaught({ baseline: true, outcomes: [o] }), false, "通ったことにしている");
});

// **退避はリポジトリの外。** 中に置くと、退避ファイル自体で判定が落ちる。
test("退避したファイルを、対象の中に置かない", () => {
  const root = project();
  const seen = [];
  applyOne(root, m(), (r) => { seen.push(readdirSync(r)); return fakeRun(r); });
  assert.deepEqual(seen[0].sort(), ["a.js"], `余計なものを置いている: ${seen[0]}`);
});

// --------------------------------------------------- 素の状態を先に見る

// **通らない状態で当てても、結果が読めない。** 落ちたのが変異のせいか分からない。
test("素の状態で落ちていたら、変異を当てずに止まる", () => {
  const root = project();
  let applied = 0;
  const result = mutate(root, [m()], () => { applied += 1; return false; });
  assert.equal(result.baseline, false);
  assert.deepEqual(result.outcomes, []);
  assert.equal(applied, 1, "素の確認すらしていない");
  assert.equal(allCaught(result), false);
  assert.ok(describe(result).join("").includes("区別できない"), "理由を言っていない");
});

// --------------------------------------------------- 実行の読み方

// **これが今回の欠陥そのもの。**
//
// `node --test test/` は常に `Cannot find module` で落ち、`# fail 0` を出さない。
// その打ち方を使うと、変異と無関係にすべて「落ちた」と読まれていた。
test("打ち方が壊れているときを、捕まえたと読まない", () => {
  // 何を渡しても失敗し、`# fail 0` を出さない実行（＝当時の打ち方）
  const brokenCommand = () => {
    throw Object.assign(new Error("Cannot find module"), { stdout: "# fail 1\n" });
  };
  const root = project();
  const run = (r) => runTests(r, brokenCommand);

  // **素の状態で落ちるので、変異は当てない。**
  const result = mutate(root, [m()], run);
  assert.equal(result.baseline, false, "素の状態の確認をすり抜けている");
  assert.equal(allCaught(result), false, "**壊れた打ち方を、捕まえたと読んでいる**");
  assert.ok(describe(result).join("").includes("変異は当てていない"), "何が起きたか言っていない");
});

// **出力の文字列で判断しない。** 実行器はファイルごとの小計も出すため、
// 全体が落ちていても、通ったファイルの小計として `# fail 0` が現れる。
// 実際にそう読んでいて、14個の変異すべてを「通った」と誤判定した。
test("小計の # fail 0 に釣られない", () => {
  const wholeRunFailed = () => {
    throw Object.assign(new Error("落ちた"), {
      stdout: "# tests 3\n# pass 3\n# fail 0\n\n# tests 9\n# pass 8\n# fail 1\n",
    });
  };
  assert.equal(runTests("/tmp", wholeRunFailed), false, "**小計に釣られている**");
});

test("通ったかどうかは、終了コードで見る", () => {
  const ok = () => "# tests 3\n# pass 3\n# fail 0\n";
  const ng = () => { throw Object.assign(new Error("x"), { stdout: "# fail 2\n" }); };
  assert.equal(runTests("/tmp", ok), true);
  assert.equal(runTests("/tmp", ng), false);
});

// **1件も走らなくても 0 で終わりうる。** それを通ったことにしない。
test("1件も走っていなければ、通ったと言わない", () => {
  assert.equal(runTests("/tmp", () => "# tests 0\n# pass 0\n# fail 0\n"), false);
  assert.equal(runTests("/tmp", () => "何も出ない"), false, "件数が読めないのに通している");
});

// --------------------------------------------------- 出し方

test("捕まえられなかったものを、目立たせる", () => {
  const text = describe({
    baseline: true,
    outcomes: [{ name: "あ", outcome: "caught" }, { name: "い", outcome: "survived" }],
  }).join("\n");
  assert.ok(text.includes("通った（捕まえていない）"), "通ったことが読めない");
  assert.ok(text.includes("1 個が捕まえられていない"), "数を出していない");
});

test("全部落ちたら、そう言う", () => {
  const text = describe({ baseline: true, outcomes: [{ name: "あ", outcome: "caught" }] }).join("\n");
  assert.ok(text.includes("すべてで落ちた"), text);
});

// 変異が残したものを、掃くこと。
//
// **壊した側が片付ける。** 変異は判定を壊すためのものであり、判定の後始末も
// 一緒に壊れる。片付けを外す変異を足したところ、1回まわすごとに 378 個残った
// （AUT-147）。判定を直しても、ここが残ると溜まり続ける。
test("この実行で残ったものだけを掃く", async () => {
  const { sweepLeftovers } = await import("../src/mutateCli.js");
  const { mkdirSync, existsSync, utimesSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tempDir } = await import("./helpers/tmp.js");

  const dir = tempDir("autodrive-掃除-");
  const 古い = join(dir, "autodrive-前からある");
  const 新しい = join(dir, "autodrive-いま作った");
  const 無関係 = join(dir, "他のツールのもの");
  for (const p of [古い, 新しい, 無関係]) mkdirSync(p, { recursive: true });

  const 境界 = Date.now();
  // **前からあるものを巻き込まない。** 他の作業が使っている置き場を消さない。
  const 昔 = new Date(境界 - 60_000);
  utimesSync(古い, 昔, 昔);

  // **新しいほうも、時刻を明示する。**
  //
  // 作った時刻に頼っていたため、**mkdir と Date.now() の間に 1ms でも進むと
  // 「前からある」と判定され、判定そのものが時々落ちていた。** 手元では通り、
  // 遅い場所や並列で混んでいるときに落ちる。判定ファイルが1つ増えただけで
  // CI が常に落ちるようになった（AUT-157）。
  //
  // **時々落ちる判定は、落ちても無視されるようになる。** 時刻を実測に頼らない。
  const 今 = new Date(境界 + 1_000);
  utimesSync(新しい, 今, 今);

  const removed = sweepLeftovers(境界 - 1, dir);
  assert.equal(existsSync(新しい), false, "**この実行で残ったものが消えていない**");
  assert.equal(existsSync(古い), true, "前からあるものを消している");
  assert.equal(existsSync(無関係), true, "関係の無いものを消している");
  assert.equal(removed, 1, "消した数が合わない");
});

// 素の状態で落ちたとき、理由を残すこと。
//
// **「落ちている」だけでは直せない。** 手元で通るのに CI で落ちたとき、原因に
// 辿り着けなかった（AUT-150）。判定の仕組みが、自分の失敗について黙るべきではない。
test("素の状態で落ちたら、そのときの出力を出す", () => {
  const { describe: say } = { describe };
  const 落ちる = () => {
    throw Object.assign(new Error("走らせられない"), {
      stdout: "# tests 3\n# fail 1\nnot ok 2 - 何かが壊れている\n",
      stderr: "Error: Cannot find module 'x'\n",
    });
  };
  const result = mutate("/tmp", [{ name: "n", file: "f", from: "a", to: "b" }], (root) => {
    try {
      落ちる();
      return true;
    } catch {
      return false;
    }
  });
  assert.equal(result.baseline, false);

  // 差し込んだ関数では出力を持てないため、出力つきの結果を直に組み立てて確かめる。
  const lines = say({
    baseline: false,
    outcomes: [],
    baselineOutput: "not ok 2 - 何かが壊れている\nError: Cannot find module 'x'",
  });
  const text = lines.join("\n");
  assert.match(text, /素の状態でテストが落ちている/);
  assert.match(text, /何かが壊れている/, "**落ちた中身を出していない**");
  assert.match(text, /Cannot find module/, "標準エラーを捨てている");
});

test("出力が無ければ、余計な見出しを出さない", () => {
  const text = describe({ baseline: false, outcomes: [] }).join("\n");
  assert.match(text, /素の状態でテストが落ちている/);
  assert.equal(text.includes("そのときの出力"), false, "空の見出しを出している");
});
