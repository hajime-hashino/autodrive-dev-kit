/**
 * 変異を当てる入口。
 *
 * ```sh
 * node src/vendored/internal/mutateCli.js mutations/aut-138.json
 * ```
 *
 * **判定そのものを判定するための仕組みである。** 通ることの確認だけでは、何も見て
 * いないテストと区別できない（配布物「確認の仕掛けは、作った時点で検証する」）。
 */

import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allCaught, describe, mutate } from "./mutate.js";

/**
 * 参照実装の根。**変異の一覧もテストも、複製されない場所にある。**
 *
 * したがってここは複製の根ではなく、リポジトリの根を指す。複製先から打つものでは
 * ない（配られはするが、プロジェクトはテストを持たない）。
 */
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * 判定が残した作業用の置き場を掃く。
 *
 * **壊した側が片付ける。** 変異は判定を壊すためのものであり、判定の後始末も
 * 一緒に壊れる。実際に、片付けを外す変異を2件足したところ、1回まわすごとに
 * 378 個残った（AUT-147）。**判定を直しても、ここが残ると溜まり続ける。**
 *
 * **この実行で作られたものだけを消す。** 時刻で見分ける。他の作業が使っている
 * 置き場を巻き込まない。
 *
 * @param {number} since この時刻より後にできたものだけを対象にする
 * @returns {number} 消した数
 */
export function sweepLeftovers(since, dir = tmpdir()) {
  let removed = 0;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith("autodrive-")) continue;
    const path = join(dir, name);
    try {
      if (statSync(path).mtimeMs < since) continue;
      rmSync(path, { recursive: true, force: true });
      removed += 1;
    } catch {
      // 消せないものは諦める。**残りの掃除を止めない。**
    }
  }
  return removed;
}

export function run(argv, root = KIT) {
  const path = argv[0];
  if (path === undefined) {
    return { output: "変異の一覧を渡すこと: mutateCli.js <path.json>", code: 2 };
  }
  let mutations;
  try {
    mutations = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { output: `変異の一覧を読めない: ${why}`, code: 2 };
  }
  if (!Array.isArray(mutations) || mutations.length === 0) {
    return { output: "変異が1つも書かれていない", code: 2 };
  }

  const startedAt = Date.now();
  const result = mutate(root, mutations);
  // **黙って掃かない。** 何を消したかは出す。消えたことに後から気づく形にしない。
  const swept = sweepLeftovers(startedAt);
  const lines = describe(result);
  if (swept > 0) lines.push("", `判定が残した作業用の置き場を ${swept} 個掃いた。`);
  return { output: lines.join("\n"), code: allCaught(result) ? 0 : 1 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(output);
  process.exit(code);
}
