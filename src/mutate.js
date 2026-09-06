/**
 * 壊した実装に対して、テストが落ちるかを確かめる。
 *
 * ## なぜ仕掛けにするか
 *
 * 手で打っていたところ、**打ち方が間違っていて、何を変異させても「落ちた」と
 * 出ていた**（AUT-138）。
 *
 * ```
 * node --test test/      # Error: Cannot find module '.../test'
 *                        # fail 1  ← 変異と無関係に、常に失敗する
 * ```
 *
 * 判定は「`# fail 0` が出力に無ければ捕まえた」だった。**この打ち方では
 * `# fail 0` は絶対に出ない。** 直した直後に、本当は捕まえていない穴が4つ出た。
 *
 * **配布物は「確認の仕掛けは、作った時点で検証する」と言っている。** 確認の仕掛けは
 * 検証していたが、**それを動かす手順は検証していなかった。**
 *
 * ## この仕掛けが自分で守ること
 *
 * 1. **素の状態で通ることを、先に確かめる。** 通らないなら、変異の結果は読めない。
 *    「落ちた」が変異のせいなのか、元から落ちていたのか区別できない
 * 2. **退避はリポジトリの外へ置く。** 中に置くと、退避ファイル自体で判定が落ちる。
 *    実際に `templates/` で起きた
 * 3. **必ず戻す。** 途中で落ちても、変異を残さない
 * 4. **見つからない変異を、通ったことにしない。** 置換元が無ければ、それは
 *    変異を当てていないのであって、捕まえたのでもない
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** @typedef {{ name: string, file: string, from: string, to: string }} Mutation */
/** @typedef {{ name: string, outcome: "caught" | "survived" | "not-applied" }} Outcome */

/**
 * テストを走らせる。**通ったかどうかだけを返す。**
 *
 * `npm test` を使う。**打ち方をここに1つだけ持つ。** 呼ぶ側が打ち方を選べると、
 * また間違える。
 *
 * ## 出力の文字列で判断しないこと
 *
 * 最初は `# fail 0` が出力にあるかで見ていた。**間違いだった。** テストの実行器は
 * ファイルごとの小計も出すため、**全体が落ちていても、通ったファイルの小計として
 * `# fail 0` が現れる。** その結果、壊した実装でも「通った」と読んでいた。
 *
 * **終了コードで見る。** 落ちれば非ゼロで、例外になる。
 *
 * ただし終了コードだけでは足りない。**1件も走らなくても 0 で終わりうる。**
 * 走った件数も併せて確かめる（AUT-138）。
 */
export function runTests(root, exec = execFileSync) {
  let out;
  try {
    out = String(exec("npm", ["test"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch (error) {
    return false; // 非ゼロで終わった＝落ちた
  }
  // **1件も走っていないなら、通ったとは言わない。**
  const ran = /^# tests (\d+)$/m.exec(out);
  return ran !== null && Number(ran[1]) > 0;
}

/** 退避の置き場。**リポジトリの外。** */
const stash = (file) => join(tmpdir(), `autodrive-mutate-${file.replace(/[^\w.]/g, "_")}`);

/**
 * 変異を1つ当てて、テストが落ちるかを見る。**必ず元に戻す。**
 *
 * @returns {Outcome}
 */
export function applyOne(root, m, run = runTests) {
  const path = join(root, m.file);
  const before = readFileSync(path, "utf8");
  if (!before.includes(m.from)) return { name: m.name, outcome: "not-applied" };

  const keep = stash(m.file);
  writeFileSync(keep, before, "utf8");
  try {
    writeFileSync(path, before.replace(m.from, m.to), "utf8");
    return { name: m.name, outcome: run(root) ? "survived" : "caught" };
  } finally {
    writeFileSync(path, readFileSync(keep, "utf8"), "utf8");
    unlinkSync(keep);
  }
}

/**
 * すべての変異を当てる。
 *
 * **素の状態で通らなければ、何も当てずに止まる。** 変異の結果が読めないためである。
 *
 * @returns {{ baseline: boolean, outcomes: Outcome[] }}
 */
export function mutate(root, mutations, run = runTests) {
  if (!run(root)) return { baseline: false, outcomes: [] };
  return { baseline: true, outcomes: mutations.map((m) => applyOne(root, m, run)) };
}

/** 人が読む形にする。**捕まえられなかったものを目立たせる。** */
export function describe({ baseline, outcomes }) {
  if (!baseline) {
    return [
      "**素の状態でテストが落ちている。変異は当てていない。**",
      "落ちたのが変異のせいか、元からかを区別できない。先に直すこと。",
    ];
  }
  const label = { caught: "落ちた  ", survived: "**通った（捕まえていない）**", "not-applied": "**当てられなかった**" };
  const lines = outcomes.map((o) => `  ${label[o.outcome]} ${o.name}`);
  const bad = outcomes.filter((o) => o.outcome !== "caught");
  lines.push("");
  lines.push(
    bad.length === 0
      ? `${outcomes.length} 個すべてで落ちた。`
      : `**${bad.length} 個が捕まえられていない。** 判定を足すこと。`,
  );
  return lines;
}

/** 捕まえられなかったものがあるか。 */
export const allCaught = ({ baseline, outcomes }) =>
  baseline && outcomes.every((o) => o.outcome === "caught");
