/**
 * 片付けの入口。
 *
 * **普段はこれを打たない。** `begin` が着手のついでに、その作業単位のリポジトリを
 * 片付ける。ここは**ワークディレクトリ全体を一度に見る**ためにある。
 *
 * 要るのは2つの場合である。
 *
 *   - 仕掛けを入れる前に溜まったものを、一度に片付けるとき
 *   - しばらく着手していないリポジトリの取りこぼしを拾うとき
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { LinearTracker } from "./adapters/trackerLinear.js";
import { describe, reconcile } from "./reconcile.js";
import { createRepoApi } from "./repoApi.js";
import { discoverRepos } from "./repos.js";

const USAGE = `統合された作業単位を閉じ、対象リポジトリを補う

  reconcile [--root <場所>] [--dry-run]

ワークディレクトリの中のリポジトリを横断して見る。統合済みの提出がある作業単位が着手中の
ままなら閉じ、対象リポジトリのラベルが無ければ補う。

  --dry-run   何が起きるかだけ出す。実装側は変えない

資格情報は LINEAR_API_KEY と、GH_TOKEN / AUTODRIVE_CI_TOKEN から読む。`;

/**
 * 何もしない Tracker。**--dry-run のために差し込む。**
 *
 * 「書かない」を分岐で表さない。分岐にすると、書く経路と書かない経路が別々に
 * 育ち、片方だけ直る。
 */
export function dryRun(tracker) {
  return {
    list: (n) => tracker.list(n),
    advance: async (id) => id,
    mark: async (id) => id,
  };
}

export async function run(argv, root, tracker, api) {
  if (argv[0] === "--help") return { output: USAGE, code: 0 };

  const { values } = parseArgs({
    args: argv,
    options: { root: { type: "string" }, "dry-run": { type: "boolean" } },
    allowPositionals: false,
    strict: true,
  });

  const base = values.root === undefined ? root : resolve(values.root);
  const repos = discoverRepos(base, "cross").map((r) => ({
    name: r.name,
    slug: r.remoteSlug(),
  }));
  if (repos.length === 0) {
    return { output: `リポジトリが1つも無い（${base}）`, code: 2 };
  }

  const result = await reconcile({
    repos,
    tracker: values["dry-run"] === true ? dryRun(tracker) : tracker,
    api,
  });
  const lines = describe(result);
  const nothing = result.closed.length === 0 && result.marked.length === 0;

  return {
    output: [
      values["dry-run"] === true ? "（--dry-run。実装側は変えていない）" : "片付けた。",
      `見たリポジトリ: ${repos.map((r) => r.name).join(", ")}`,
      ...(nothing && result.unreadable.length === 0 ? ["", "片付けるものは無かった。"] : lines),
    ].join("\n"),
    // **読めなかったものがあれば失敗として返す。** 0 を返すと「全部見た」と読める。
    code: result.unreadable.length > 0 ? 1 : 0,
  };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const token = process.env.LINEAR_API_KEY;
  if (token === undefined) {
    console.error("Tracker の資格情報が無い（LINEAR_API_KEY 未設定）");
    process.exit(2);
  }
  const tracker = new LinearTracker(token, process.env.AUTODRIVE_TRACKER_TEAM);
  const api = createRepoApi(process.env.AUTODRIVE_CI_TOKEN ?? process.env.GH_TOKEN);
  try {
    const { output, code } = await run(process.argv.slice(2), root, tracker, api);
    (code === 0 ? console.log : console.error)(output);
    process.exit(code);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
