/**
 * 不変条件の状態を判定する。
 *
 * 定義§9の4つの不変条件それぞれについて、有効であるか、有効でないなら、何が手で
 * 代替しているかを判定して出力する。
 *
 * 使い方は README.md、判定基準の全文は docs/invariants.md を参照。
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { CHECKS, hookRegistered } from "./checks.js";

import { JsonlTelemetry } from "./adapters/telemetryJsonl.js";
import { createRepoApi } from "./repoApi.js";
import { createTracker } from "./ports/trackerFactory.js";
import { discoverRepos } from "./repos.js";
import { readConfig } from "./config.js";
import { describe as describeTracked, forbidden } from "./tracked.js";
import { describe as describeIsolation, isolationGaps } from "./isolation.js";
import { describe as describeSections, drift, findDefinition } from "./definitionSections.js";

import { renderJson, renderText } from "./report.js";
import { ACTIVE, INVARIANTS, Result } from "./state.js";

import { loadEvents } from "./telemetry.js";

const USAGE = `不変条件の状態を判定する

  invariants [--root PATH] [--scope cross|self] [--format text|json]
  invariants --enact <不変条件のキー> [--root PATH]
  invariants --substitute <不変条件のキー> --by <主体> --detail <内容> [--root PATH]

  --root    判定の起点。既定はカレントディレクトリ
  --scope   cross: 起点と直下のリポジトリを横断して判定（既定）
            self:  起点のリポジトリのみ
  --format  text（既定）または json
  --enact   有効境界を進める。これ以降の記録が判定の対象になる。
            記録を自動で残す仕掛けが登録されていなければ拒否する。
            有効境界はアダプタ経由で書かれるため、アダプタが壊れていれば進められない。
  --substitute
            有効になっていない不変条件について、何が手で代替しているかを記録する。
            定義§9の立ち上げ期の例外は、この記録があることを条件としている。
            既に有効である不変条件に対しては拒否する。

終了コード 0=失敗なし / 1=代替の記録が無い、または判定できない / 2=対象が無い
判定基準の全文は docs/invariants.md を参照。`;

/**
 * 有効境界を進める。
 *
 * 仕掛けが登録されていることを先に確かめる。登録が無い状態で有効境界だけ進めると、
 * 記録が続く保証が無いまま有効を名乗ることになる。
 *
 * 有効境界はアダプタ経由で書く。この経路を通れること自体が、アダプタが動いている
 * 証明になる。壊れていれば有効境界を進められず、直書きのまま有効を名乗れない。
 */
function enact(invariant , root , repos) {
  const known = INVARIANTS.map((i) => i.key);
  if (!known.includes(invariant)) {
    return { output: `知らない不変条件: ${invariant}\n候補: ${known.join(" / ")}`, code: 2 };
  }
  const registeredIn = hookRegistered(repos);
  if (registeredIn === null) {
    return {
      output: "記録を自動で残す仕掛けが .claude/settings.json に登録されていない。\n" +
        "登録しないまま有効境界を進めると、記録が続く保証が無いまま有効を名乗ることになる。",
      code: 1,
    };
  }
  const telemetry = new JsonlTelemetry(resolve(root));
  const boundary = new Date().toISOString();
  telemetry.recordEnactment(
    invariant,
    `有効境界を進めた。仕掛けは ${registeredIn} に登録されている`,
    boundary,
  );
  const written = telemetry.lastWrite;
  if (written === null || !written.attributed) {
    return {
      output: "有効境界の記録が作業単位に紐づかなかった。着手してから実行すること。",
      code: 1,
    };
  }
  return {
    output:
      `${invariant} の有効境界を進めた: ${written.path}\n` +
      `${boundary} 以前の記録は判定の対象から外れる（履歴としては残る）`,
    code: 0,
  };
}

/**
 * 有効になっていない不変条件について、何が手で代替しているかを記録する。
 *
 * 定義§9の立ち上げ期の例外は「代替した事実を記録に残すこと」を条件としている。
 * 手段が無ければ条件を満たしようがない。
 *
 * **既に有効である不変条件に対しては拒否する。** 代替が要らない状態に代替の
 * 記録を足すと、有効が落ちたときに古い記録が残って判定を誤らせる。
 *
 * 記録はアダプタ経由で書く。手で書けば有効が落ちる形は保つ。
 */
async function substitute(
  invariant ,
  by ,
  detail ,
  root ,
  input ,
) {
  const known = INVARIANTS.map((i) => i.key);
  if (!known.includes(invariant)) {
    return { output: `知らない不変条件: ${invariant}\n候補: ${known.join(" / ")}`, code: 2 };
  }
  if ((by ?? "").trim() === "") return { output: "--by は必須（何が代替しているか）", code: 2 };
  if ((detail ?? "").trim() === "") return { output: "--detail は必須", code: 2 };

  const check = CHECKS.find((c) => c.key === invariant);
  if (check !== undefined) {
    const current = await check.run(input);
    if (current.state === ACTIVE) {
      return {
        output: `${invariant} は既に有効である。代替の記録は要らない。`,
        code: 2,
      };
    }
  }

  const telemetry = new JsonlTelemetry(resolve(root));
  telemetry.recordSubstitution(invariant, by , detail);
  const written = telemetry.lastWrite;
  if (written === null || !written.attributed) {
    return { output: "代替の記録が作業単位に紐づかなかった。着手してから実行すること。", code: 1 };
  }
  return { output: `${invariant} の代替を記録した: ${written.path}`, code: 0 };
}

export async function run(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      root: { type: "string", default: "." },
      scope: { type: "string", default: "cross" },
      format: { type: "string", default: "text" },
      enact: { type: "string" },
      substitute: { type: "string" },
      by: { type: "string" },
      detail: { type: "string" },
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
  const scope = values.scope;

  // 有効境界を進める操作も代替の記録も、リポジトリをまたいだ状態に対して行う。
  const writing = values.enact !== undefined || values.substitute !== undefined;
  const repos = discoverRepos(values.root, writing ? "cross" : scope);
  if (repos.length === 0) {
    return { output: `判定対象のリポジトリが見つからない: ${resolve(values.root)}`, code: 2 };
  }

  const { events, broken } = loadEvents(repos);
  const api = createRepoApi(process.env.AUTODRIVE_CI_TOKEN);
  // **構成に書かれた実装で組み立てる。** 組み立てられなければ null のまま進み、
  // 判定はその旨を観測として出す（判定できないことを、通過にしない）。
  const { tracker } = createTracker(values.root);
  // **起点も渡す。** 登録されたフックの指す先を、起点からも探すため（AUT-207）。
  /** @type {import("./checks.js").CheckInput} */
  const input = { repos, events, broken, api, tracker, scope, root: resolve(values.root) };

  if (values.enact !== undefined) return enact(values.enact, values.root, repos);
  if (values.substitute !== undefined) {
    return await substitute(values.substitute, values.by, values.detail, values.root, {
      ...input,
      scope: "cross",
    });
  }

  const results = [];
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

  // **セットアップと同じ設定を使う。** 言語の設定が2つに割れると、片方だけ英語と
  // いう状態ができる（AUT-135）。構成が読めなければ日本語のまま出す。
  const language = readConfig(values.root).config?.language ?? "ja";

  // **追跡してはいけないものが追跡されていないか。**
  //
  // 不変条件ではない（定義§9は4つで固定）。配布物の「守ること」にある
  // 「本番の資格情報を手元に置かない」の検出手段である。規約はあったが、
  // 見る仕掛けが無かった（AUT-137）。
  //
  // **既製品が見ない場所だけを見る。** gitleaks はバイナリを走査せず、
  // GitHub の Secret Protection は private + Free では使えない。
  const tracked = repos.flatMap((r) =>
    forbidden(r.path, r.trackedFiles()).map((f) => ({ ...f, path: `${r.name}/${f.path}` })),
  );

  // **隔離の設定が保たれているか。**
  //
  // 不変条件ではない（定義§9は4つで固定）。配布物の「守ること」にある隔離の
  // 検出手段である。`.devcontainer/devcontainer.json` をプロジェクトのものに
  // したため、触れるようになった代わりにここで見る（AUT-157）。
  const isolation = repos.flatMap((r) =>
    isolationGaps(r.path).map((g) => ({ ...g, path: `${r.name}/${g.path}` })),
  );

  // **引いている定義の節が、引いているつもりの節のままか。**
  //
  // 不変条件ではない（定義§9は4つで固定）。上の2つと同じ位置に置く。
  //
  // **横断でしか見られない。** 定義リポジトリが並んでいる場所だけが判定できる。
  // 無ければ何も返さず、素通りする（AUT-232）。
  const sections = drift(findDefinition(values.root));

  const body =
    values.format === "json"
      ? renderJson(results, repos, scope, language, tracked, isolation)
      : renderText(results, repos, scope, language);
  return {
    output:
      values.format === "json"
        ? body
        : [
            body,
            ...describeTracked(tracked),
            ...describeIsolation(isolation),
            ...describeSections(sections),
          ].join("\n"),
    code: exitCode(results, tracked.length, isolation.length, sections.length),
  };
}

/**
 * 終了コード。
 *
 * **追跡してはいけないものがあれば落とす。** 不変条件が全部通っていても落とす。
 * 落ちなければ、CI では誰も気づかない（AUT-137）。
 *
 * **隔離の設定が欠けていても落とす。** 同じ理由である。触ってよいファイルに
 * した以上、壊れたまま統合される経路を残さない（AUT-157）。
 *
 * **定義の節が動いていても落とす。** 観測に留めると、直す機会が来ない。実際に
 * 11箇所が別の節を指したまま、誰も気づかなかった（AUT-232）。
 *
 * **判断をここへ出しているのは、直接確かめるためである。** `invariants` を通して見ると、
 * 一時リポジトリでは記録が無くてどのみち落ちるため、差が出ない。
 */
export function exitCode(results, forbiddenCount, isolationCount = 0, sectionCount = 0) {
  const failing = results.some((r) => r.failing);
  return failing || forbiddenCount > 0 || isolationCount > 0 || sectionCount > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = await run(process.argv.slice(2));
  (code === 2 ? console.error : console.log)(output);
  process.exit(code);
}
