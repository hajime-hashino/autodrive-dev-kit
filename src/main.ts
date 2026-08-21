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
import { CHECKS, hookRegistered } from "./checks.ts";
import { JsonlTelemetry } from "./adapters/telemetryJsonl.ts";
import { boundaryFor } from "./enactment.ts";
import { createRepoApi } from "./repoApi.ts";
import { LinearTracker } from "./adapters/trackerLinear.ts";
import { discoverRepos } from "./repos.ts";
import type { Repo } from "./repos.ts";
import { renderJson, renderText } from "./report.ts";
import { INVARIANTS, Result } from "./state.ts";
import type { Scope } from "./state.ts";
import { loadEvents } from "./telemetry.ts";

const USAGE = `不変条件の発効判定器

  verify [--root PATH] [--scope cross|self] [--format text|json]
  verify --enact <不変条件のキー> [--root PATH]

  --root    判定の起点。既定はカレントディレクトリ
  --scope   cross: 起点と直下のリポジトリを横断して判定（既定）
            self:  起点のリポジトリのみ
  --format  text（既定）または json
  --enact   発効境界を進める。これ以降の記録が判定の対象になる。
            記録を自動で残す仕掛けが登録されていなければ拒否する。
            印はアダプタ経由で書かれるため、アダプタが壊れていれば進められない。

終了コード 0=失敗なし / 1=代替の記録が無い、または判定できない / 2=対象が無い
判定基準の全文は docs/verify-criteria.md を参照。`;

/**
 * 発効境界を進める。
 *
 * 仕掛けが登録されていることを先に確かめる。登録が無い状態で印だけ進めると、
 * 記録が続く保証が無いまま発効を名乗ることになる。
 *
 * 印はアダプタ経由で書く。この経路を通れること自体が、アダプタが動いている
 * 証明になる。壊れていれば印を進められず、直書きのまま発効を名乗れない。
 */
function enact(invariant: string, root: string, repos: Repo[]): { output: string; code: number } {
  const known = INVARIANTS.map((i) => i.key);
  if (!known.includes(invariant)) {
    return { output: `知らない不変条件: ${invariant}\n候補: ${known.join(" / ")}`, code: 2 };
  }
  const registeredIn = hookRegistered(repos);
  if (registeredIn === null) {
    return {
      output: "記録を自動で残す仕掛けが .claude/settings.json に登録されていない。\n" +
        "登録しないまま境界を進めると、記録が続く保証が無いまま発効を名乗ることになる。",
      code: 1,
    };
  }
  const telemetry = new JsonlTelemetry(resolve(root));
  telemetry.recordEnactment(invariant, `発効境界を進めた。仕掛けは ${registeredIn} に登録されている`);
  const written = telemetry.lastWrite;
  if (written === null || !written.attributed) {
    return {
      output: "境界の記録が作業単位に紐づかなかった。着手してから実行すること。",
      code: 1,
    };
  }
  return { output: `${invariant} の発効境界を進めた: ${written.path}`, code: 0 };
}

export async function run(argv: string[]): Promise<{ output: string; code: number }> {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string", default: "." },
      scope: { type: "string", default: "cross" },
      format: { type: "string", default: "text" },
      enact: { type: "string" },
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

  const repos = discoverRepos(values.root, values.enact === undefined ? scope : "cross");
  if (repos.length === 0) {
    return { output: `判定対象のリポジトリが見つからない: ${resolve(values.root)}`, code: 2 };
  }

  if (values.enact !== undefined) return enact(values.enact, values.root, repos);

  const { events, broken } = loadEvents(repos);
  const api = createRepoApi(process.env.AUTODRIVE_CI_TOKEN);
  const trackerToken = process.env.LINEAR_API_KEY;
  const tracker =
    trackerToken === undefined
      ? null
      : new LinearTracker(trackerToken, process.env.AUTODRIVE_TRACKER_TEAM);
  const input = { repos, events, broken, api, tracker, scope };

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
