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
import { slugFromUrl } from "../repos.js";
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

/**
 * 組み立てる。**組み立てられない理由は、そのまま返す。**
 *
 * **null を返して黙らない。** 資格情報が無いのか、構成が欠けているのか、
 * 対象が読めないのかで、人がやることが違う。
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {() => string | null} slug リポジトリの `owner/repo` を返す
 * @returns {{ tracker: TrackerPort | null, error: string | null, implementation: string }}
 */
export function createTracker(root, env = process.env, slug = () => slugAt(root)) {
  const { config } = readConfig(root);
  // **構成が無ければ linear とみなす。** `init` を打っていない作業場があり、
  // そこはこれまで linear で動いてきた。既定を変えると黙って止まる。
  const implementation = config?.ports.tracker ?? "linear";

  if (implementation === "linear") {
    const token = env.LINEAR_API_KEY;
    if (token === undefined || token === "") {
      return { tracker: null, error: "Tracker の資格情報が無い（LINEAR_API_KEY 未設定）", implementation };
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
          "Tracker の資格情報が無い（AUTODRIVE_TRACKER_TOKEN も GH_TOKEN も未設定）。" +
          "**GH_TOKEN があれば足りる**（Issues の読み書きが要る）",
        implementation,
      };
    }
    const prefix = config?.tracker.prefix ?? null;
    if (prefix === null) {
      return {
        tracker: null,
        error:
          "autodrive.json に tracker.prefix が無い。**作業単位IDの頭に付く2〜4文字を決めること**" +
          "（例: AIEP → AIEP-123）。**決めるのは人である。** 決まったら autodrive.json の " +
          "tracker.prefix に書く（`apply` は構成が既にあると止まるため、聞き直しには使えない）",
        implementation,
      };
    }
    const where = slug();
    if (where === null) {
      return {
        tracker: null,
        error: "作業単位の置き場を読めない。**origin のリモートが GitHub を指していること**",
        implementation,
      };
    }
    return { tracker: new GithubIssuesTracker(token, where, prefix), error: null, implementation };
  }

  return {
    tracker: null,
    error: `Tracker の実装が分からない: ${implementation}（autodrive.json の ports.tracker）`,
    implementation,
  };
}
