/**
 * 構成に書かれた実装で、Tracker を組み立てる。
 *
 * ## なぜ要るか
 *
 * `autodrive.json` の `ports.tracker` は**どこからも読まれていなかった。** Linear が
 * 4箇所で直に new されており、**実装を選んだつもりでも選べていなかった**（AUT-234）。
 *
 * 定義§16 は「実装名を知るのはアダプタだけとする」と言っている。呼び出し側が
 * `new LinearTracker(...)` と書いている限り、その形になっていない。**ここが、
 * 実装名の出てくる最後の場所である。**
 *
 * ## 資格情報の名前
 *
 * | 実装 | 環境変数 |
 * |---|---|
 * | linear | `LINEAR_API_KEY` |
 * | github-issues | `AUTODRIVE_TRACKER_TOKEN` |
 *
 * **Linear の名前は変えない。** 既に配った先が壊れる。
 */

import { execFileSync } from "node:child_process";

import { readConfig } from "../config.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { discoverRepos, slugFromUrl } from "../repos.js";
import { resolveRepo } from "../workItem.js";
import { LinearTracker } from "../adapters/trackerLinear.js";
import { GithubIssuesTracker } from "../adapters/trackerGithub.js";

/**
 * 起点のリモートから `owner/repo` を読む。**読めなければ null。**
 *
 * 作業単位は、その仕組みを使うリポジトリの中にある。**起点がそのリポジトリである。**
 */
export function slugAt(root) {
  try {
    return slugFromUrl(
      execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

/** @typedef {import("./tracker.js").TrackerPort} TrackerPort */
/** @typedef {import("./tracker.js").TrackerReader} TrackerReader */

/**
 * 組み立てる。**組み立てられない理由は、そのまま返す。**
 *
 * **null を返して黙らない。** 資格情報が無いのか、構成が欠けているのか、
 * 対象が読めないのかで、人がやることが違う。
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {() => string | null} slug リポジトリの `owner/repo` を返す
 * @param {string | null} override 構成に書かれた実装の代わりに使う実装
 * @returns {{ tracker: TrackerPort | null, error: string | null, implementation: string }}
 */
export function createTracker(root, env = process.env, slug = () => slugAt(root), override = null) {
  const { config } = readConfig(root);
  // **構成が無ければ linear とみなす。** `init` を打っていない作業場があり、
  // そこはこれまで linear で動いてきた。既定を変えると黙って止まる。
  //
  // `override` は、差し替える前の実装で作業単位を扱うときに使う（`createTrackerAt`）。
  const implementation = override ?? config?.ports.tracker ?? "linear";

  if (implementation === "linear") {
    const token = env.LINEAR_API_KEY;
    if (token === undefined || token === "") {
      return { tracker: null, error: "No Tracker credentials (LINEAR_API_KEY not set)", implementation };
    }
    return {
      tracker: new LinearTracker(token, env.AUTODRIVE_TRACKER_TEAM),
      error: null,
      implementation,
    };
  }

  if (implementation === "github-issues") {
    // **無ければ `GH_TOKEN` を使う。** どちらもエージェントが自分の作業のために
    // 持つ書ける鍵であり、同じ対象を指す。**分けても守れるものが増えない**（AUT-235）。
    //
    // **`AUTODRIVE_CI_TOKEN` は兼ねない。** あちらは判定が使う読むだけの鍵であり、
    // 兼ねると判定する側が判定対象を書き換えられる（定義§9）。**その関係は、
    // ここには無い。**
    //
    // **`AUTODRIVE_TRACKER_TOKEN` を読むのはやめない。** 絞りたい人は分けられる。
    const token = env.AUTODRIVE_TRACKER_TOKEN || env.GH_TOKEN;
    if (token === undefined || token === "") {
      return {
        tracker: null,
        error:
          "No Tracker credentials (neither AUTODRIVE_TRACKER_TOKEN nor GH_TOKEN is set). " +
          "**GH_TOKEN is enough** (it needs read and write access to Issues)",
        implementation,
      };
    }
    const prefix = config?.tracker.prefix ?? null;
    if (prefix === null) {
      return {
        tracker: null,
        error:
          "autodrive.json has no tracker.prefix. **Decide the 2–4 characters that lead each work item ID**" +
          " (e.g. AIEP → AIEP-123). **It is the human who decides.** Once decided, write it in " +
          "tracker.prefix in autodrive.json (`apply` stops if a configuration already exists, so it cannot be used to ask again)",
        implementation,
      };
    }
    const where = slug();
    if (where === null) {
      return {
        tracker: null,
        error: "Cannot read where work items are kept. **The origin remote must point at GitHub**",
        implementation,
      };
    }
    return { tracker: new GithubIssuesTracker(token, where, prefix), error: null, implementation };
  }

  return {
    tracker: null,
    error: `Unknown Tracker implementation: ${implementation} (ports.tracker in autodrive.json)`,
    implementation,
  };
}

/**
 * 判定のために、記録を照合する先をすべて組み立てる（AUT-277）。
 *
 * ## なぜ起点の1つでは足りないか
 *
 * 作業単位は、変更を書き込むリポジトリごとに置かれうる。GitHub Issues なら
 * そのリポジトリの Issues にある。**起点の Tracker だけで照合すると、他の
 * リポジトリの作業単位を指す記録が、すべて「実在しない」になる。**
 *
 * 実装を差し替えた場合も同じである。それまでの記録は以前の作業単位IDを指して
 * いる。**`tracker.previous` に書かれた実装も、照合先に加える。**
 *
 * ## 照合は、束ねた一覧で行う
 *
 * 作業単位IDは接頭辞で分かれており、実装をまたいで重ならない。**どの記録を
 * どこで照合するかを振り分ける必要が無い。**
 *
 * ## 鍵は読むだけのものを使う
 *
 * GitHub Issues は `AUTODRIVE_CI_TOKEN` で読む。**判定する側に書ける鍵を
 * 持たせない**（定義§9）。CI もこの鍵で判定を打っている。
 *
 * **組み立てられないものが1つでもあれば、組み立てない。** 欠けた照合先は、
 * 実在する作業単位を実在しないと言う。
 *
 * @param {Array<{ path: string, name: string, remoteSlug: () => string | null }>} repos
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ tracker: TrackerReader | null, error: string | null, sources: string[] }}
 */
export function createJudgingTracker(repos, env = process.env) {
  /** @type {Map<string, () => { tracker: TrackerReader | null, error: string | null }>} */
  const sources = new Map();

  for (const repo of repos) {
    const { config, error } = readConfig(repo.path);
    if (error !== null) return { tracker: null, error: `${repo.name}: ${error}`, sources: [] };
    // 構成が無ければ linear とみなす（`createTracker` と同じ）。
    const current = config?.ports.tracker ?? "linear";
    for (const implementation of [current, ...(config?.tracker.previous ?? [])]) {
      if (implementation === "linear") {
        sources.set("linear", () => {
          const token = env.LINEAR_API_KEY;
          if (token === undefined || token === "") {
            return { tracker: null, error: "No Tracker credentials (LINEAR_API_KEY not set)" };
          }
          return { tracker: new LinearTracker(token, env.AUTODRIVE_TRACKER_TEAM), error: null };
        });
        continue;
      }
      if (implementation === "github-issues") {
        const where = repo.remoteSlug();
        const prefix = config?.tracker.prefix ?? null;
        sources.set(`github-issues (${where ?? repo.name})`, () => {
          if (where === null) {
            return { tracker: null, error: `${repo.name}: cannot read where work items are kept (the origin remote must point at GitHub)` };
          }
          if (prefix === null) {
            return { tracker: null, error: `${repo.name}: autodrive.json has no tracker.prefix` };
          }
          const token = env.AUTODRIVE_CI_TOKEN;
          if (token === undefined || token === "") {
            return {
              tracker: null,
              error:
                "No credentials to read GitHub Issues for the checks (AUTODRIVE_CI_TOKEN not set). " +
                "**It needs Issues: Read.** A key that can write is not used for checking",
            };
          }
          return { tracker: new GithubIssuesTracker(token, where, prefix), error: null };
        });
        continue;
      }
      return {
        tracker: null,
        error: `${repo.name}: unknown Tracker implementation: ${implementation}`,
        sources: [],
      };
    }
  }

  const built = [];
  for (const build of sources.values()) {
    const { tracker, error } = build();
    if (tracker === null) return { tracker: null, error, sources: [] };
    built.push(tracker);
  }

  return {
    tracker: {
      async list() {
        const items = [];
        for (const t of built) items.push(...(await t.list()));
        return items;
      },
    },
    error: null,
    sources: [...sources.keys()],
  };
}

/**
 * 操作の対象から、その作業単位を持つ Tracker を組み立てる（AUT-278）。
 *
 * ## なぜ起点の構成では足りないか
 *
 * 作業単位は、変更を書き込むリポジトリごとに置かれうる。複数のリポジトリを並べた
 * 作業場では、起点（`CLAUDE_PROJECT_DIR`）は作業場そのものであり、**対象の
 * リポジトリではない。** 起点の構成で組み立てると、起点の Issues を探して見つからない。
 *
 * ## 決め方
 *
 * 1. **作業単位IDがあれば、ID で決める。** `tracker.prefix` が ID の頭と一致する
 *    リポジトリの構成を使う。ID が決める以上、ほかの手がかりより確かである
 * 2. 一致しなければ、**接頭辞を持たない実装（linear）の ID とみなす。** 起点が
 *    linear ならそのまま。起点が別の実装でも、linear を使っている・使っていた
 *    リポジトリがあれば linear で組み立てる（差し替える前の作業単位を閉じるため）
 * 3. ID が無く `--repo` があれば（起票）、そのリポジトリの構成を使う
 * 4. どれも無ければ、起点の構成を使う
 *
 * **決められなければ、黙って起点に倒さない。** 別の Issues を探して「見つからない」
 * と言われても、何が間違っているのか分からない。
 *
 * @param {string} root
 * @param {{ id?: string | null, repo?: string | null }} target
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ tracker: TrackerPort | null, error: string | null, implementation: string }}
 */
export function createTrackerAt(root, { id = null, repo = null } = {}, env = process.env) {
  const repos = discoverRepos(root, "cross");
  const configs = repos.map((r) => ({ repo: r, config: readConfig(r.path).config }));
  const at = (r) => createTracker(r.path, env, () => r.remoteSlug());

  if (id !== null && id !== "") {
    const owner = configs.find(
      ({ config }) =>
        config?.ports.tracker === "github-issues" &&
        config.tracker.prefix !== null &&
        new RegExp(`^${config.tracker.prefix}-\\d+$`).test(id),
    );
    if (owner !== undefined) return at(owner.repo);

    const rootImplementation = readConfig(root).config?.ports.tracker ?? "linear";
    if (rootImplementation === "linear") return createTracker(root, env);
    const usesLinear = configs.some(
      ({ config }) =>
        (config?.ports.tracker ?? "linear") === "linear" || (config?.tracker.previous ?? []).includes("linear"),
    );
    if (usesLinear) return createTracker(root, env, undefined, "linear");

    const prefixes = configs.map(({ config }) => config?.tracker.prefix).filter((p) => typeof p === "string");
    return {
      tracker: null,
      error:
        `Cannot tell which repository ${id} belongs to. ` +
        `**No tracker.prefix in autodrive.json matches it** (known: ${prefixes.join(", ") || "none"})`,
      implementation: rootImplementation,
    };
  }

  if (repo !== null && repo !== "") {
    const path = resolveRepo(root, repo);
    if (!existsSync(join(path, ".git"))) {
      return {
        tracker: null,
        error: `Target repository ${repo} is not in the working directory (${path})`,
        implementation: readConfig(root).config?.ports.tracker ?? "linear",
      };
    }
    return createTracker(path, env, () => slugAt(path));
  }

  return createTracker(root, env);
}
