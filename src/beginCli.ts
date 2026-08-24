/**
 * 着手の入口。
 *
 * **1つの操作にまとめる。** 着手には、作業単位の確認・作業空間の用意・マーカーの
 * 設置の3つが要る。手で順に踏む形だと、どれかを飛ばしたことに気づけない。実際に
 * 記録へ残っている失敗は次の3件で、いずれも規約には明記されていた。
 *
 *   AUT-38  マージ済みの提出の枝へ push した（修正が既定ブランチに届かなかった）
 *   AUT-42  マーカーを前の作業単位のままにした
 *   AUT-42  枝を切らずに既定ブランチへ直接コミットした
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
import { LinearTracker } from "./adapters/trackerLinear.ts";
import type { TrackerPort, WorkItemView } from "./ports/tracker.ts";
import { writeMarker } from "./trackerCli.ts";

const USAGE = `作業単位に着手する

  begin <作業単位ID> --repo <対象リポジトリ> [--branch <枝の名前>]

次の3つをまとめて行う。どれかが成り立たなければ、進めずに止める。

  1. 作業単位を取得し、対象リポジトリを確かめる
  2. 作業空間を用意する（既定ブランチを最新にし、枝を切る）
  3. 状態を started へ進め、記録の紐づけ先を設置する

枝の名前を省略すると、作業単位のIDから作る。
資格情報は環境変数 LINEAR_API_KEY から読む。`;

export interface Git {
  (repoPath: string, args: string[]): string;
}

/** 既定の git。失敗は例外にせず、呼び出し側が文言を組み立てられるようにする。 */
export const runGit: Git = (repoPath, args) =>
  execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** 枝の名前。作業単位のIDを小文字にしたものを既定とする。 */
export function branchNameFor(workItemId: string, given: string | undefined): string {
  const trimmed = (given ?? "").trim();
  if (trimmed !== "") return trimmed;
  return workItemId.toLowerCase();
}

function fail(lines: string[]): { output: string; code: number } {
  return { output: lines.join("\n"), code: 1 };
}

export async function run(
  argv: string[],
  root: string,
  tracker: TrackerPort,
  git: Git = runGit,
): Promise<{ output: string; code: number }> {
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
  let item: WorkItemView | null;
  try {
    item = await tracker.get(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/not found|見つから/i.test(message)) {
      return fail([`Tracker を読めない: ${message}`, "資格情報と通信を確かめること。"]);
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
      `対象リポジトリ ${repo} が作業場に無い（${repoPath}）。`,
      "名前が正しいか、作業場に取得されているかを確かめること。",
    ]);
  }

  // 2. 作業空間 -------------------------------------------------------------
  let current: string;
  let defaultBranch: string;
  try {
    current = git(repoPath, ["branch", "--show-current"]).trim();
    defaultBranch = git(repoPath, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
      .trim()
      .replace(/^origin\//, "");
  } catch (error) {
    return fail([
      `${repo} の状態を読めない: ${error instanceof Error ? error.message : String(error)}`,
      "作業ツリーが壊れていないかを確かめること。",
    ]);
  }

  // **別の枝の上から始めない。** 前の作業の枝に積むと、その提出が閉じている場合、
  // 変更は既定ブランチへ届かない（AUT-38）。
  if (current !== defaultBranch) {
    return fail([
      `${repo} はいま ${current} にいる（既定ブランチは ${defaultBranch}）。`,
      "前の作業の枝の上から始めると、その提出が閉じている場合に変更が届かない。",
      "",
      "次のどちらかを行うこと。",
      `  - 前の作業が統合済みなら: git -C ${repo} checkout ${defaultBranch}`,
      "  - まだ提出していないなら: 先にその作業を提出してから着手する",
    ]);
  }

  try {
    git(repoPath, ["pull", "--ff-only", "origin", defaultBranch]);
  } catch (error) {
    return fail([
      `${repo} の ${defaultBranch} を最新にできない: ${error instanceof Error ? error.message : String(error)}`,
      "既定ブランチに手元だけのコミットが残っている可能性がある。",
      `  git -C ${repo} log --oneline origin/${defaultBranch}..${defaultBranch}`,
      "出てきたコミットは、枝へ移して提出すること。",
    ]);
  }

  const branch = branchNameFor(item.id, values.branch);
  try {
    git(repoPath, ["checkout", "-b", branch]);
  } catch (error) {
    return fail([
      `枝 ${branch} を作れない: ${error instanceof Error ? error.message : String(error)}`,
      "同じ名前の枝が既にある場合は --branch で別の名前を渡すこと。",
    ]);
  }

  // 3. マーカー -------------------------------------------------------------
  await tracker.advance(item.id, "started");
  writeMarker(root, item.id, repo);

  // 手元に残っている変更は、そのまま新しい枝へ移る。消さないが、黙らない。
  const dirty = git(repoPath, ["status", "--short"]).trim();
  const carried = dirty === "" ? [] : ["", "手元の変更を枝へ持ってきた:", ...dirty.split("\n").map((l) => `  ${l}`)];

  return {
    output: [
      `${item.id} に着手した: ${item.title}`,
      item.url,
      "",
      `対象リポジトリ  ${repo}`,
      `枝              ${branch}（${defaultBranch} から）`,
      `記録の紐づけ先  ${repo} の ${item.id}`,
      ...carried,
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
  try {
    const { output, code } = await run(argv, root, tracker);
    (code === 0 ? console.log : console.error)(output);
    process.exit(code);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
