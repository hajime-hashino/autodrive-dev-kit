/**
 * 引いている定義の節が、引いているつもりの節のままか。
 *
 * **通ることの確認だけでは、何も見ていない判定と区別できない。** 動かし方を
 * 1つずつ当てて、落ちることまで見る。
 *
 * **出力の経路まで見る。** 純粋な関数が正しくても、呼ばれていなければ何も
 * 起きない。実際に3回それで通していた。
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  EXPECTED,
  describe,
  drift,
  findDefinition,
  readSections,
} from "../src/vendored/internal/definitionSections.js";
import { tempDir } from "./helpers/tmp.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** いまの定義と同じ節の並びを書き出す。 */
const asDocument = (sections) =>
  `# 定義\n\n${Object.entries(sections)
    .map(([n, title]) => `## ${n}. ${title}\n\n本文\n`)
    .join("\n")}`;

/** 食い違いが無い本文。 */
const intact = () => asDocument(EXPECTED);

/** 定義リポジトリを置いた起点を作る。 */
function workspace(text) {
  const root = tempDir("autodrive-sections-");
  mkdirSync(join(root, "autodrive-dev-definition"), { recursive: true });
  writeFileSync(join(root, "autodrive-dev-definition", "README.md"), text, "utf8");
  return root;
}

// ------------------------------------------------------------ 読み取り

test("番号の付いた見出しを読む", () => {
  const sections = readSections("# 題\n\n## 1. 一文定義\n\n本文\n\n## 18. 未確定事項\n");

  assert.equal(sections.get(1), "一文定義");
  assert.equal(sections.get(18), "未確定事項");
  assert.equal(sections.size, 2);
});

// **番号の無い見出しを拾わない。** ライセンスの節などが混ざる。
test("番号の無い見出しは拾わない", () => {
  assert.equal(readSections("## ライセンス\n\n## 書き方\n").size, 0);
});

// ------------------------------------------------------------ 動かし方を当てる

test("揃っていれば、何も言わない", () => {
  assert.deepEqual(drift(intact()), []);
});

// **AUT-212 で実際に起きた形。** §17 が新設され、未確定事項が §18 へ動いた。
// 番号は実在し続けるため、存在の検査では捕まらない。
test("中身が入れ替わった節を捕まえる", () => {
  const moved = { ...EXPECTED, 18: "Product quality" };

  const found = drift(asDocument(moved));
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].n, 18);
  assert.equal(found[0].expected, "Open items");
  assert.equal(found[0].actual, "Product quality");
});

// **番号ごと消えた場合も捕まえる。**
test("節が消えた形を捕まえる", () => {
  const { 16: _removed, ...rest } = EXPECTED;

  const found = drift(asDocument(rest));
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].n, 16);
  assert.equal(found[0].actual, null);
});

// **引いていない節が動いても、言わない。** 引いていないものは壊れようがない。
test("引いていない節が増えても、何も言わない", () => {
  const added = asDocument(EXPECTED).replace("# 定義\n", "# 定義\n\n## 99. 新しい節\n\n本文\n");

  assert.deepEqual(drift(added), []);
});

// ------------------------------------------------------------ 見つからないとき

// **定義が並んでいない場所では判定しない。** 配られた先には定義が無い。
test("定義が無ければ、何も言わない", () => {
  const root = tempDir("autodrive-sections-none-");

  assert.equal(findDefinition(root), null);
  assert.deepEqual(drift(findDefinition(root)), []);
});

// **読み方が壊れているときに、全件を食い違いとして出さない。** 直す先を
// 取り違えることになる。
test("節を1つも読み取れなければ、何も言わない", () => {
  assert.deepEqual(drift("見出しがひとつも無い本文"), []);
});

// ------------------------------------------------------------ 伝え方

test("引いているつもりと、いまそこにあるものを、両方出す", () => {
  const text = describe([{ n: 18, expected: "未確定事項", actual: "プロダクトの品質" }]).join("\n");

  assert.ok(text.includes("定義§18"), text);
  assert.ok(text.includes("未確定事項"), text);
  assert.ok(text.includes("プロダクトの品質"), text);
  // **写しの更新まで言う。** 言わないと、次に動いたときも同じ見落としが起きる。
  assert.ok(text.includes("EXPECTED"), text);
});

test("節が無い場合も、そう出す", () => {
  const text = describe([{ n: 16, expected: "ポート", actual: null }]).join("\n");
  assert.ok(text.includes("その番号の節が無い"), text);
});

test("食い違いが無ければ、何も言わない", () => {
  assert.deepEqual(describe([]), []);
});

// ------------------------------------------------------------ CI で落ちること

// **見つけても落ちなければ、誰も気づかない。** 11箇所が別の節を指したまま
// 残っていたのは、落ちる経路が無かったからである。
test("不変条件が全部通っていても、節が動いていれば落ちる", async () => {
  const { exitCode } = await import("../src/vendored/internal/main.js");
  const allPassing = [{ failing: false }, { failing: false }];

  assert.equal(exitCode(allPassing, 0, 0, 0), 0, "何も無いのに落ちている");
  assert.equal(exitCode(allPassing, 0, 0, 1), 1, "**節が動いているのに落ちていない**");
});

// **`invariants` の出力に出ること。** 判断が正しくても、呼ばれていなければ何も起きない。
test("`invariants` を通しても、節の食い違いが出力に出る", async () => {
  const root = workspace(asDocument({ ...EXPECTED, 18: "Product quality" }));
  mkdirSync(join(root, ".git"), { recursive: true });

  const { run } = await import("../src/vendored/internal/main.js");
  const { output, code } = await run(["--root", root, "--scope", "cross"]);

  assert.ok(output.includes("定義の節が動いている"), output.slice(-600));
  assert.ok(output.includes("Product quality"), "いまそこにあるものを出していない");
  assert.equal(code, 1, "出しているのに落ちていない");
});

// ------------------------------------------------------------ 写しの手入れ

/** この参照実装の中で `定義§N` を引いている番号を、すべて集める。 */
function referenced(dir, found = new Set()) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      referenced(path, found);
      continue;
    }
    if (!/\.(js|md|ya?ml)$/.test(entry.name)) continue;
    for (const m of readFileSync(path, "utf8").matchAll(/定義§(\d+)/g)) found.add(Number(m[1]));
  }
  return found;
}

// **足し忘れると、その番号は判定されない。** 判定されないことは、通ったことと
// 区別がつかない。
test("引いている節は、すべて写しに載っている", () => {
  const missing = [...referenced(join(KIT, "src")), ...referenced(join(KIT, "docs"))]
    .filter((n) => EXPECTED[n] === undefined)
    .sort((a, b) => a - b);

  assert.deepEqual(
    [...new Set(missing)],
    [],
    "`定義§N` を引いているのに EXPECTED に無い。足すこと",
  );
});

// **写しが実物と合っていること。** この作業場でだけ確かめられる。
test("写しが、実物の定義と合っている", (t) => {
  const real = resolve(KIT, "..", "autodrive-dev-definition", "README.md");
  if (!existsSync(real)) {
    t.skip("定義リポジトリが並んでいない（配られた先では確かめられない）");
    return;
  }

  assert.deepEqual(drift(readFileSync(real, "utf8")), []);
});
