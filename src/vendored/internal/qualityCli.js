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

const USAGE = `Produce the quality evidence

  quality [--root <path>] [--scope cross|self] [--format text|json]

  --root    Where it starts. Defaults to the current directory
  --scope   cross (default) also looks at the repositories directly under it. self looks only here
  --format  text (default) or json

**No score is given.** It shows what was checked and how far, and where nobody is looking.
Whether that is good or bad is for the reader to decide.`;

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
    return { output: `--scope must be cross or self (received: ${values.scope})`, code: 2 };
  }
  if (values.format !== "text" && values.format !== "json") {
    return { output: `--format must be text or json (received: ${values.format})`, code: 2 };
  }

  const repos = discoverRepos(resolve(values.root), values.scope);
  if (repos.length === 0) {
    return {
      output:
        `No repository found at ${resolve(values.root)}.\n` +
        "Records rest on the git history. Point at the starting point with `--root`.",
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
      `## Records that could not be read (${broken.length})`,
      "**These are not included in any of the numbers above.**",
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
