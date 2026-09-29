/**
 * 引いている定義の節が、引いているつもりの節のままか。
 *
 * ## なぜ作ったか
 *
 * 定義が §17「プロダクトの品質」を新設し、旧 §17（未確定事項）が §18 になった
 * （定義 v0.17）。**参照実装と題材アプリに、古い §17 を指す記述が11箇所残った。**
 * 誰も気づかなかった。
 *
 * 定義リポジトリの `docs/quality.md` は、この穴を**先に見つけていた。**
 *
 * ```
 * 定義と実装のずれ | 無い | 参照実装のテストが `定義§n` を23箇所で引くが、
 *                          引いた先が定義と合っているかは誰も見ていない
 * ```
 *
 * **書いてあったが、仕掛けは置かなかった。** 置かないと決めた記録でもなかった。
 *
 * ## 存在の検査では足りない
 *
 * 素直に思いつくのは「その番号の節が実在するか」だが、**それでは捕まらない。**
 * §17 は実在し続けている。中身が別物になっただけである。
 *
 * **番号と、引いているつもりの見出しを対で持つ。** 突き合わせて初めて、
 * 指す先が入れ替わったことが分かる。
 *
 * ## 何を見ないか
 *
 * **節の中身は見ていない。** 見出しが同じまま本文が書き換わった場合は素通りする。
 * そこまで見るには、引用した文そのものを持つことになる。
 *
 * **`§N` 単独の書き方も見ていない。** 定義を指すとは限らないためである。
 * `§4(a)` のように Apache-2.0 の節を指しているものが実際にある。**拾うと誤検出する。**
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 定義リポジトリの置き場所。
 *
 * **手法が定める並びであり、この作業場だけのものではない。** 4つのリポジトリが
 * 並ぶ形は定義と参照実装が共有している。見つからなければ判定しない。
 */
const DEFINITION_REPO = "autodrive-dev-definition";

/** 節の一覧が書かれている場所。 */
const DEFINITION_FILE = "README.md";

/**
 * 引いている節と、そのときの見出し。
 *
 * **ここに無い番号は判定されない。** 新しく `定義§N` を引いたら、ここへ足すこと。
 * 足し忘れは `definitionSections.test.js` が捕まえる。
 *
 * **写しを持つことになるが、これは検出のための写しである。** 揃っていることを
 * 前提にせず、食い違いを出すために持つ。
 */
export const EXPECTED = {
  1: "One-sentence definition",
  4: "The variable to maximize",
  5: "Structure: two loops",
  6: "What telemetry records",
  8: "Operating the scope of delegation",
  9: "Fixed conditions and invariants",
  10: "Roles",
  14: "Relation to other ways of working",
  16: "Swappable components (ports)",
  17: "Product quality",
  18: "Open items",
};

/**
 * 本文から節の一覧を読む。
 *
 * @param {string} text
 * @returns {Map<number, string>}
 */
export function readSections(text) {
  const sections = new Map();
  for (const m of text.matchAll(/^## (\d+)\. (.+)$/gm)) {
    sections.set(Number(m[1]), m[2].trim());
  }
  return sections;
}

/**
 * 定義の本文を探す。**見つからなければ null。**
 *
 * @param {string} root 判定の起点
 * @returns {string | null}
 */
export function findDefinition(root) {
  const path = join(root, DEFINITION_REPO, DEFINITION_FILE);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * 指す先が入れ替わった節を返す。
 *
 * @param {string | null} text 定義の本文。無ければ null
 * @returns {Array<{ n: number, expected: string, actual: string | null }>}
 */
export function drift(text) {
  if (text === null) return [];
  const sections = readSections(text);
  // **1つも読み取れないなら、判定しない。** 読み方が壊れているときに
  // 全件を食い違いとして出すと、直す先を取り違える。
  if (sections.size === 0) return [];

  const moved = [];
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const n = Number(key);
    const actual = sections.get(n) ?? null;
    if (actual !== expected) moved.push({ n, expected, actual });
  }
  return moved;
}

/**
 * 見つかったものを人に伝える。
 *
 * **どこを直すかまで出す。** 番号が動いたことだけでは、何箇所直すのかが分からない。
 */
export function describe(moved) {
  if (moved.length === 0) return [];
  return [
    "",
    `Sections of the definition have moved (${moved.length}). **Text citing these numbers points at a different section.**`,
    "",
    ...moved.flatMap((m) => [
      `  definition §${m.n}`,
      `      Meant to cite: ${m.expected}`,
      `      What is there now: ${m.actual ?? "**no section with that number**"}`,
      "",
    ]),
    "Review the places citing `definition §N` (or `定義§N`). **After fixing, update EXPECTED too.**",
    "Without updating it, the same oversight happens the next time sections move.",
  ];
}
