/**
 * 不変条件の発効判定器。
 *
 * 定義§9の4つの不変条件それぞれについて、発効しているか、未発効なら何が手で
 * 代替しているかを判定して出力する。
 *
 * 使い方は README.md、判定基準の全文は docs/verify-criteria.md を参照。
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { CHECKS } from "./checks.ts";
import { createRepoApi } from "./repoApi.ts";
import { discoverRepos } from "./repos.ts";
import { renderJson, renderText } from "./report.ts";
import { INVARIANTS, Result } from "./state.ts";
import type { Scope } from "./state.ts";
import { loadEvents } from "./telemetry.ts";

const USAGE = `不変条件の発効判定器

  verify [--root PATH] [--scope cross|self] [--format text|json]

  --root    判定の起点。既定はカレントディレクトリ
  --scope   cross: 起点と直下のリポジトリを横断して判定（既定）
            self:  起点のリポジトリのみ
  --format  text（既定）または json

終了コード 0=失敗なし / 1=代替の記録が無い、または判定できない / 2=対象が無い
判定基準の全文は docs/verify-criteria.md を参照。`;

export async function run(argv: string[]): Promise<{ output: string; code: number }> {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string", default: "." },
      scope: { type: "string", default: "cross" },
      format: { type: "string", default: "text" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) return { output: USAGE, code: 0 };
  if (values.scope !== "cross" && values.scope !== "self") {
    return { output: `--scope は cross か self（受け取った値: ${values.scope}）`, code: 2 };
  }
  if (values.format !== "text" && values.format !== "json") {
    return { output: `--format は text か json（受け取った値: ${values.format}）`, code: 2 };
  }
  const scope: Scope = values.scope;

  const repos = discoverRepos(values.root, scope);
  if (repos.length === 0) {
    return { output: `判定対象のリポジトリが見つからない: ${resolve(values.root)}`, code: 2 };
  }

  const { events, broken } = loadEvents(repos);
  const api = createRepoApi(process.env.AUTODRIVE_CI_TOKEN);
  const input = { repos, events, broken, api, scope };

  const results: Result[] = [];
  for (const { key, label } of INVARIANTS) {
    const check = CHECKS.find((c) => c.key === key);
    if (check === undefined) throw new Error(`判定が登録されていない不変条件: ${key}`);
    if (!check.scopes.has(scope)) {
      results.push(
        new Result(key, label).skip(
          "リポジトリをまたいで初めて成立するため、--scope cross でのみ判定する",
        ),
      );
      continue;
    }
    results.push(await check.run(input));
  }

  const render = values.format === "json" ? renderJson : renderText;
  return { output: render(results, repos, scope), code: results.some((r) => r.failing) ? 1 : 0 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = await run(process.argv.slice(2));
  (code === 2 ? console.error : console.log)(output);
  process.exit(code);
}
