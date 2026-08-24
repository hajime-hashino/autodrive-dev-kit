import assert from "node:assert/strict";
import { test } from "node:test";
import { directCommitCandidates, localDefaultBranch } from "../src/directCommits.ts";
import type { Repo } from "../src/repos.ts";

/**
 * git の応答を差し替えたリポジトリ。
 *
 * 履歴は `%H\t%P\t%s` の形で、親の一覧を第2列に置く。
 */
function repoWith(log: string | null, head: string | null = "origin/main\n"): Repo {
  return {
    name: "r",
    path: "/tmp/r",
    remoteSlug: () => "owner/r",
    git: (...args: string[]) => {
      if (args[0] === "symbolic-ref") return head;
      if (args[0] === "log") {
        // 既定ブランチを渡していることを確かめる。渡し忘れても履歴が返る形だと、
        // どの枝を見たのかがテストから読めなくなる。
        assert.equal(args.at(-1), "origin/main");
        return log;
      }
      return null;
    },
  } as unknown as Repo;
}

const merge = (sha: string, subject = "Merge pull request") => `${sha}\tp1 p2\t${subject}`;
const direct = (sha: string, subject = "直接コミット") => `${sha}\tp1\t${subject}`;
const root = (sha: string, subject = "初期化") => `${sha}\t\t${subject}`;

const history = (...lines: string[]) => lines.join("\n");

// ------------------------------------------------------------ 既定ブランチ

test("手元の設定から既定ブランチを読む", () => {
  assert.equal(localDefaultBranch(repoWith(null)), "main");
});

// **無いことを異常としない。** `git clone` は origin/HEAD を置くが、`git init`
// から作った作業ツリーには無い。実際に1リポジトリで無かった。ここで止めると、
// 問題の無いリポジトリへ誤警報を出すことになる。呼び出し側が Repo に尋ねて補う。
test("手元に設定が無ければ null を返す。異常にはしない", () => {
  assert.equal(localDefaultBranch(repoWith(null, null)), null);
  assert.equal(localDefaultBranch(repoWith(null, "  ")), null);
});

// ------------------------------------------------------------ 候補の抽出

test("提出を経た変更だけなら、候補は出ない", () => {
  const found = directCommitCandidates(repoWith(history(merge("bbb"), merge("ccc"), root("aaa"))), "main");
  assert.deepEqual(found, []);
});

// **リポジトリの作成時点は除く。** 提出の仕組みがまだ存在しない。
test("親を持たない最初のコミットは候補にしない", () => {
  assert.deepEqual(directCommitCandidates(repoWith(root("aaa")), "main"), []);
});

// AUT-42 の再現。枝を切らずに既定ブランチへコミットした。
test("マージでないコミットを候補として出す", () => {
  const found = directCommitCandidates(
    repoWith(history(merge("ccc"), direct("bbb", "AUT-42 直接コミット"), root("aaa"))),
    "main",
  );
  assert.equal(found?.length, 1);
  assert.equal(found?.[0].sha, "bbb");
  assert.equal(found?.[0].subject, "AUT-42 直接コミット");
});

test("複数あればすべて出す", () => {
  const found = directCommitCandidates(
    repoWith(history(direct("ddd"), merge("ccc"), direct("bbb"), root("aaa"))),
    "main",
  );
  assert.deepEqual(found?.map((c) => c.sha), ["ddd", "bbb"]);
});

// **「調べたが無かった」と「調べられなかった」を同じ値にしない。**
// 空配列で返すと、判定できない状態が通過に紛れる。
test("履歴を読めなければ null を返す。空配列にしない", () => {
  assert.equal(directCommitCandidates(repoWith(null), "main"), null);
});

test("履歴が空でも、読めているなら空配列を返す", () => {
  assert.deepEqual(directCommitCandidates(repoWith(""), "main"), []);
});
