/**
 * 品質の証跡を出す入口。
 *
 * **判定ではない。** `invariants` は通る／落ちるを返すが、これは返さない。
 * 読んだ人が判断するための材料を並べるだけである（定義§1「測らない」）。
 *
 * したがって**終了コードで良し悪しを表さない。** 読めたかどうかだけを返す。
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { discoverRepos } from "./repos.js";
import { evidence, render } from "./quality.js";

const USAGE = `品質の証跡を出す

  quality [--root <場所>] [--scope cross|self] [--format text|json]

  --root    判定の起点。既定はカレントディレクトリ
  --scope   cross（既定）は直下のリポジトリも見る。self はここだけ
  --format  text（既定）または json

**点は付けない。** 何をどこまで確かめたかと、誰も見ていないのはどこかを出す。
良いか悪いかは読んだ人が決める。`;

export function run(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        root: { type: "string", default: "." },
        scope: { type: "string", default: "cross" },
        format: { type: "string", default: "text" },
        help: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    return { output: `${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`, code: 2 };
  }

  if (values.help) return { output: USAGE, code: 0 };
  if (values.scope !== "cross" && values.scope !== "self") {
    return { output: `--scope は cross か self（受け取った値: ${values.scope}）`, code: 2 };
  }
  if (values.format !== "text" && values.format !== "json") {
    return { output: `--format は text か json（受け取った値: ${values.format}）`, code: 2 };
  }

  const repos = discoverRepos(resolve(values.root), values.scope);
  if (repos.length === 0) {
    return {
      output:
        `${resolve(values.root)} にリポジトリが見つからない。\n` +
        "記録は git の履歴の上で成り立っている。起点を `--root` で指すこと。",
      code: 2,
    };
  }

  const { data, broken } = evidence(repos);

  if (values.format === "json") {
    // **読めなかった行も出す。** 黙ると、読めた分が全部だと受け取られる。
    return { output: `${JSON.stringify({ ...data, broken }, null, 2)}\n`, code: 0 };
  }

  const lines = [render(data)];
  if (broken.length > 0) {
    lines.push(
      "",
      `## 読めなかった記録（${broken.length} 件）`,
      "**この分は、上のどの数にも入っていない。**",
      ...broken.slice(0, 10).map((b) => `  ${b}`),
    );
  }
  return { output: lines.join("\n"), code: 0 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = run(process.argv.slice(2));
  (code === 0 ? console.log : console.error)(output);
  process.exit(code);
}
