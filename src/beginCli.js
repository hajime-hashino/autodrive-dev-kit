/**
 * 着手の入口。
 *
 * **1つの操作にまとめる。** 着手には、作業単位の確認・作業空間の用意・マーカーの
 * 設置の3つが要る。手で順に踏む形だと、どれかを飛ばしたことに気づけない。実際に
 * 記録へ残っている失敗は次の3件で、いずれも規約には明記されていた。
 *
 *   AUT-38  マージ済みの提出のブランチへ push した（修正が既定ブランチに届かなかった）
 *   AUT-42  マーカーを前の作業単位のままにした
 *   AUT-42  ブランチを作らずに既定ブランチへ直接コミットした
 *
 * **規約が存在しても、手順を通らなければ思い出す機会が無い。** 通らないと始まら
 * ない入口を置くことで、思い出す必要そのものを減らす。
 *
 * 前提が崩れている場合は進めずに止める。**止まるときは、なぜ・何をすればよいかを
 * 出す。** 「失敗しました」で終わらせない。
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LinearTracker } from "./adapters/trackerLinear.js";
import { createRepoApi } from "./repoApi.js";
import { describe, reconcile } from "./reconcile.js";
import { slugFromUrl } from "./repos.js";
import { writeMarker } from "./trackerCli.js";

const USAGE = `作業単位に着手する

  begin <作業単位ID> --repo <対象リポジトリ> [--branch <ブランチ名>]

次をまとめて行う。1〜3のどれかが成り立たなければ、進めずに止める。

  1. 作業単位を取得し、対象リポジトリを確かめる
  2. 作業空間を用意する（既定ブランチを最新にし、ブランチを作る）
  3. 状態を started へ進め、対象リポジトリを記し、記録の紐づけ先を設置する
  4. 統合済みなのに着手中のままの作業単位を閉じる

ブランチ名を省略すると、作業単位のIDから作る。
資格情報は環境変数 LINEAR_API_KEY から読む。4 には Repo の資格情報も要る
（GH_TOKEN / AUTODRIVE_CI_TOKEN）。無ければ 4 は飛ばす。着手は成立する。`;

/** @typedef {{ (repoPath: string, args: string[]): string }} Git */
/** 既定の git。失敗は例外にせず、呼び出し側が文言を組み立てられるようにする。 */
export const runGit = (repoPath, args) =>
  execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** ブランチ名。作業単位のIDを小文字にしたものを既定とする。 */
export function branchNameFor(workItemId , given) {
  const trimmed = (given ?? "").trim();
  if (trimmed !== "") return trimmed;
  return workItemId.toLowerCase();
}

function fail(lines) {
  return { output: lines.join("\n"), code: 1 };
}

/** 例外から読める文を取り出す。 */
export function message(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 既定ブランチ。特定できなければ null。
 *
 * **手元の設定が無いことを異常としない。** `git clone` は `origin/HEAD` を置くが、
 * `git init` から作った作業ツリーには無い。ここで落とすと、問題の無いリポジトリで
 * 着手できなくなる。
 *
 * `invariants` では Repo に尋ねて補っている（AUT-53）。ここでは**資格情報を前提に
 * できない**ため、手元から引き直す。引けなければ、何をすればよいかを出して止まる。
 */
export function defaultBranchOf(repoPath , git) {
  const read = () => {
    try {
      const value = git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .trim()
        .replace(/^origin\//, "");
      return value === "" ? null : value;
    } catch {
      return null;
    }
  };

  const found = read();
  if (found !== null) return found;

  // 引き直す。**手元の設定を直すだけで、書き換えるのは設定であってコードではない。**
  try {
    git(repoPath, ["remote", "set-head", "origin", "-a"]);
  } catch {
    return null;
  }
  return read();
}

export async function run(
  argv ,
  root ,
  tracker ,
  git = runGit,
  api = undefined,
) {
  if (argv.length === 0 || argv[0] === "--help") return { output: USAGE, code: argv.length === 0 ? 0 : 0 };

  const { values, positionals } = parseArgs({
    args: argv,
    options: { repo: { type: "string" }, branch: { type: "string" } },
    allowPositionals: true,
    strict: true,
  });

  const id = positionals[0];
  if (id === undefined) return { output: "作業単位のIDが要る\n\n" + USAGE, code: 2 };
  const repo = (values.repo ?? "").trim();
  if (repo === "") {
    return {
      output: [
        "--repo が要る（記録の書き込み先になる）",
        "1つの作業単位が変更を書き込むリポジトリは1つに限る。作業単位の本文に対象が書かれている。",
      ].join("\n"),
      code: 2,
    };
  }

  // 1. 作業単位 -------------------------------------------------------------
  //
  // **見つからないことを、通信の失敗と同じ扱いにしない。** Tracker の実装に
  // よっては存在しないIDで例外を投げる。そのまま外へ出すと「Entity not found」
  // だけが表示され、何をすればよいかが伝わらない。
  let item;
  try {
    item = await tracker.get(id);
  } catch (error) {
    if (!/not found|見つから/i.test(message(error))) {
      return fail([`Tracker を読めない: ${message(error)}`, "資格情報と通信を確かめること。"]);
    }
    item = null;
  }
  if (item === null) {
    return fail([
      `作業単位 ${id} が見つからない。`,
      "起票してから着手すること。起票は `tracker 作業単位を起票する` で行う。",
    ]);
  }

  const repoPath = repo === basename(root) ? root : join(root, repo);
  if (!existsSync(join(repoPath, ".git"))) {
    return fail([
      `対象リポジトリ ${repo} がワークディレクトリに無い（${repoPath}）。`,
      "名前が正しいか、ワークディレクトリに取得されているかを確かめること。",
    ]);
  }

  // 2. 作業空間 -------------------------------------------------------------
  let current;
  try {
    current = git(repoPath, ["branch", "--show-current"]).trim();
  } catch (error) {
    return fail([
      `${repo} の状態を読めない: ${message(error)}`,
      "作業ツリーが壊れていないかを確かめること。",
    ]);
  }

  const defaultBranch = defaultBranchOf(repoPath, git);
  if (defaultBranch === null) {
    return fail([
      `${repo} の既定ブランチを特定できない。`,
      "`git clone` は origin/HEAD を置くが、`git init` から作った作業ツリーには無い。",
      "",
      "次を実行してから、もう一度着手すること。",
      `  git -C ${repo} remote set-head origin -a`,
    ]);
  }

  // **別のブランチの上から始めない。** 前の作業のブランチに積むと、その提出が閉じている場合、
  // 変更は既定ブランチへ届かない（AUT-38）。
  if (current !== defaultBranch) {
    return fail([
      `${repo} はいま ${current} にいる（既定ブランチは ${defaultBranch}）。`,
      "前の作業のブランチの上から始めると、その提出が閉じている場合に変更が届かない。",
      "",
      "次のどちらかを行うこと。",
      // **先に既定ブランチを進める。** 進めずに切り替えると、統合済みの記録と
      // 手元の記録が食い違い、未コミットの追記があると切り替えられない。
      //
      // トークン消費の記録は**提出のあとにも届く**（提出を作る間と、CI を待つ間）
      // ため、これは例外ではなく毎回起きる。実際に4回とも起きた（AUT-118）。
      //
      // 進めておけば、記録ファイルはブランチと同じ中身になり、**追記はそのまま次のブランチへ
      // 持ち越されて、次の提出に乗る。**
      `  - 前の作業が統合済みなら: git -C ${repo} fetch origin ${defaultBranch}:${defaultBranch} && git -C ${repo} checkout ${defaultBranch}`,
      "  - まだ提出していないなら: 先にその作業を提出してから着手する",
    ]);
  }

  try {
    git(repoPath, ["pull", "--ff-only", "origin", defaultBranch]);
  } catch (error) {
    return fail([
      `${repo} の ${defaultBranch} を最新にできない: ${message(error)}`,
      "既定ブランチに手元だけのコミットが残っている可能性がある。",
      `  git -C ${repo} log --oneline origin/${defaultBranch}..${defaultBranch}`,
      "出てきたコミットは、ブランチへ移して提出すること。",
    ]);
  }

  const branch = branchNameFor(item.id, values.branch);
  try {
    git(repoPath, ["checkout", "-b", branch]);
  } catch (error) {
    return fail([
      `ブランチ ${branch} を作れない: ${message(error)}`,
      "同じ名前のブランチが既にある場合は --branch で別の名前を渡すこと。",
    ]);
  }

  // 3. マーカー -------------------------------------------------------------
  //
  // **対象リポジトリを Tracker にも記す。** 手元のマーカーだけに書いていたため、
  // 一覧を見てもどれがどのリポジトリの作業か分からなかった（AUT-114）。
  await tracker.advance(item.id, "started", repo);
  writeMarker(root, item.id, repo);

  // 手元に残っている変更は、そのまま新しいブランチへ移る。消さないが、黙らない。
  const dirty = git(repoPath, ["status", "--short"]).trim();
  const carried = dirty === "" ? [] : ["", "手元の変更をブランチへ持ってきた:", ...dirty.split("\n").map((l) => `  ${l}`)];

  // 4. 片付け ---------------------------------------------------------------
  //
  // **着手のついでに閉じる。** 閉じるための手順を別に置くと、思い出す必要が増える。
  // ここは必ず通るため、思い出さなくても片付く。
  //
  // **失敗しても着手は成立させる。** 片付けられないことを理由に着手できなくなるのは
  // 本末転倒である。ただし黙らない。
  let tidied = [];
  if (api !== undefined) {
    try {
      // **置き場所も、差し込まれた git から引く。** ここで自前の git を呼ぶと、
      // 差し込みが効かず、判定できない経路が残る。
      let origin = null;
      try {
        origin = git(repoPath, ["remote", "get-url", "origin"]);
      } catch {
        origin = null;
      }
      tidied = describe(
        await reconcile({
          repos: [{ name: repo, slug: slugFromUrl(origin) }],
          tracker,
          api,
          except: item.id,
        }),
      );
    } catch (error) {
      tidied = ["", `統合済みの作業単位を片付けられなかった: ${message(error)}`];
    }
  }

  return {
    output: [
      `${item.id} に着手した: ${item.title}`,
      item.url,
      "",
      `対象リポジトリ  ${repo}`,
      `ブランチ              ${branch}（${defaultBranch} から）`,
      `記録の紐づけ先  ${repo} の ${item.id}`,
      ...carried,
      ...tidied,
    ].join("\n"),
    code: 0,
  };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const token = process.env.LINEAR_API_KEY;
  const argv = process.argv.slice(2);
  if (token === undefined && argv.length > 0) {
    console.error("Tracker の資格情報が無い（LINEAR_API_KEY 未設定）");
    process.exit(2);
  }
  const tracker = new LinearTracker(token ?? "", process.env.AUTODRIVE_TRACKER_TEAM);
  // 片付けは提出を読むだけである。**読取で足りるものに、書ける資格情報を要求しない。**
  const api = createRepoApi(process.env.AUTODRIVE_CI_TOKEN ?? process.env.GH_TOKEN);
  try {
    const { output, code } = await run(argv, root, tracker, runGit, api);
    (code === 0 ? console.log : console.error)(output);
    process.exit(code);
  } catch (error) {
    console.error(message(error));
    process.exit(1);
  }
}
