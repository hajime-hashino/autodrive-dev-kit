/**
 * 変異を当てる入口。
 *
 * ```sh
 * node src/mutateCli.js mutations/aut-138.json
 * ```
 *
 * **判定そのものを判定するための道具である。** 通ることの確認だけでは、何も見て
 * いないテストと区別できない（配布物「確認の仕掛けは、作った時点で検証する」）。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allCaught, describe, mutate } from "./mutate.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function run(argv, root = KIT) {
  const path = argv[0];
  if (path === undefined) {
    return { output: "変異の一覧を渡すこと: mutateCli.js <path.json>", code: 2 };
  }
  let mutations;
  try {
    mutations = JSON.parse(readFileSync(resolve(root, path), "utf8"));
  } catch (error) {
    return { output: `変異の一覧を読めない: ${error.message}`, code: 2 };
  }
  if (!Array.isArray(mutations) || mutations.length === 0) {
    return { output: "変異が1つも書かれていない", code: 2 };
  }

  const result = mutate(root, mutations);
  return { output: describe(result).join("\n"), code: allCaught(result) ? 0 : 1 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(output);
  process.exit(code);
}
