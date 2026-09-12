/**
 * 現在の作業単位の解決と、記録の置き場所。
 *
 * ## 何で引くか
 *
 * **いま居るリポジトリのブランチで引く。** 見つからなければマーカーで引く。
 *
 * マーカー1つで引いていた間、**提出のあとに書いた記録が、次の作業単位に紐づいた。**
 * 提出したあとに人の指摘が来るのは普通のことで、そのときマーカーは既に次を指して
 * いる。実際に3件が誤った先へ向かった（AUT-172）。
 *
 * **帰属しないより悪い。** 帰属しないことは `invariants` が件数で出すが、**誤った
 * 作業単位への帰属は誰も気づかない。**
 *
 * ブランチは作業単位ごとに分かれており、**行き来しても入れ替わらない。** 並列に
 * ワークツリーを作る形とも噛み合う。
 *
 * ### ブランチ名から作業単位IDを推測しない
 *
 * `begin` が対応を書き残す（`work-items.json`）。名前の形から逆算すると、
 * `--branch` で別名を渡された場合に外れ、**作業単位でないブランチ名から
 * 存在しないIDを作ってしまう。**
 *
 * ### ADR 0002 の判断は、前提が変わっている
 *
 * 当時「セッション記録の `gitBranch` が全行 `HEAD` なので、ブランチ名から引く案は
 * 成立しない」とした。**いまは行ごとに実際のブランチが入る**（2026-09-12 実測）。
 *
 * ただしここが読むのはセッション記録ではなく、**書く時点の作業ツリーそのもの**で
 * ある。実行基盤の都合に依存しない。
 *
 * マーカーは作業状態であって成果物ではないため、リポジトリには入れない。
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** 作業状態の置き場所。work リポジトリ直下、追跡対象外。 */
export const STATE_DIR = ".autodrive";

/** ブランチと作業単位の対応表。`begin` が書き、記録のときに引く。 */
const BRANCH_MAP = "work-items.json";

/**
 * 起点を探し上げる。
 *
 * **打つ場所で結果が変わらないようにする。** 子リポジトリの中から記録コマンドを
 * 打つと、起点がそのディレクトリになり、マーカーもセッションの記録も見つからな
 * かった。見つからない理由として「作業単位に紐づかないやり取りである可能性がある」
 * と出るが、**それは誤った説明である**（AUT-172）。誤った理由が残ると、後から
 * 読んだ人を誤らせる。
 */
export function findRoot(from) {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, STATE_DIR))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** 記録コマンドが使う起点。**環境変数が最優先、次に探し上げ。** */
export function defaultRoot(env = process.env, cwd = process.cwd()) {
  return env.CLAUDE_PROJECT_DIR ?? findRoot(cwd) ?? cwd;
}

/** 対応表の鍵。リポジトリ名とブランチの組。 */
export function branchKey(repo, branch) {
  return `${repo}/${branch}`;
}

/**
 * いま居る作業ツリーのリポジトリ名とブランチ。
 *
 * **起点の下にあるものだけを認める。** 外のリポジトリで打たれた場合に、
 * 関係のない対応を拾わないため。
 */
export function currentBranch(root, cwd, git = gitIn) {
  let top;
  let branch;
  try {
    top = resolve(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
    branch = git(cwd, ["branch", "--show-current"]).trim();
  } catch {
    return null;
  }
  if (branch === "") return null; // 切り離された HEAD

  const base = resolve(root);
  if (top !== base && dirname(top) !== base) return null;
  return { repo: basename(top), branch };
}

/** 既定の git。読み取りだけで、失敗は呼び出し側が握りつぶす。 */
function gitIn(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** 対応表を読む。壊れていても落とさない。 */
export function readBranchMap(root) {
  const path = join(root, STATE_DIR, BRANCH_MAP);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 対応を書き残す。`begin` から呼ばれる。
 *
 * **消さずに足す。** 前の作業単位のブランチが残っている限り、そこへ戻って書いた
 * 記録も正しく紐づく。それがこの表の目的である。
 */
export function rememberBranch(root, repo, branch, workItemId) {
  const dir = join(root, STATE_DIR);
  mkdirSync(dir, { recursive: true });
  const map = readBranchMap(root);
  map[branchKey(repo, branch)] = { work_item_id: workItemId, repo };
  writeFileSync(join(dir, BRANCH_MAP), `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

/** @typedef {{ workItemId: string, repoPath: string }} WorkItem */
/** @typedef {{ item: WorkItem | null, unattributedReason: string | null }} WorkItemResolution */

/**
 * 現在の作業単位を解決する。
 *
 * **解決できない理由を3つに見分ける。** 定義§6（v0.10）は、作業単位に帰属しない
 * やり取りが実在することを認める一方、**帰属できるものは必ず紐づける**ことを求めて
 * いる。マーカーが壊れている場合は帰属できたはずの記録であり、そもそも作業単位が
 * 無い場合とは意味が違う。同じ言葉で報告すると、壊れているのか、紐づく先が無い
 * のかを読んだ側が区別できない。
 *
 * 原因の違うものを同じ言葉で言い切って人を誤らせた例が、記録に3件ある
 * （AUT-37 の2件・AUT-39）。同じ型をここで繰り返さない。
 */
export function resolveWorkItem(root, cwd = process.cwd(), git = gitIn) {
  // **まずブランチで引く。** マーカーは1つしか無く、次の作業へ進むと入れ替わる。
  // ブランチは作業単位ごとに残るので、戻って書いた記録も正しい先へ向かう。
  const here = currentBranch(root, cwd, git);
  if (here !== null) {
    const found = readBranchMap(root)[branchKey(here.repo, here.branch)];
    if (found !== undefined && typeof found.work_item_id === "string") {
      const repoPath = resolveRepo(root, here.repo);
      if (existsSync(repoPath)) {
        return { item: { workItemId: found.work_item_id, repoPath }, unattributedReason: null };
      }
    }
  }

  const path = join(root, STATE_DIR, "current-work-item.json");
  if (!existsSync(path)) {
    return {
      item: null,
      unattributedReason:
        "作業単位マーカーが無い。作業単位に紐づかないやり取り（起票するかの検討など）である可能性がある",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {
      item: null,
      unattributedReason:
        "作業単位マーカーが読めない。壊れている。**紐づけられたはずの記録が帰属しないまま残る**",
    };
  }

  const workItemId = typeof parsed.work_item_id === "string" ? parsed.work_item_id.trim() : "";
  const repo = typeof parsed.repo === "string" ? parsed.repo.trim() : "";
  if (workItemId === "" || repo === "") {
    const missing = [workItemId === "" ? "work_item_id" : null, repo === "" ? "repo" : null]
      .filter((v) => v !== null)
      .join(" / ");
    return {
      item: null,
      unattributedReason: `作業単位マーカーの内容が欠けている（${missing}）。**紐づけられたはずの記録が帰属しないまま残る**`,
    };
  }

  // **無い場所には書かない。** 記録の追記は途中のディレクトリごと作るため、
  // 指す先が存在しなくても**「記録した」と表示されて成功に見える。** `invariants` が
  // 見るのは `<対象リポジトリ>/telemetry/` であり、そこに無い記録は無いのと同じ
  // である。しかも作られた場所は追跡対象外なので、そのまま消える（AUT-143）。
  //
  // 直したのは相対パスの取り違えだが、**取り違えの原因は1つとは限らない。**
  // マーカーのリポジトリ名が古くなった場合も同じ形で黙る。ここで塞ぐ。
  //
  // **`.git` までは求めない。** 求めれば「記録は追跡される場所に置く」まで言えるが、
  // それは観測されていない失敗に対する強化である。ここで塞ぐのは、**実際に起きた
  // 「無い場所が作られる」だけにする。**
  const repoPath = resolveRepo(root, repo);
  if (!existsSync(repoPath)) {
    return {
      item: null,
      unattributedReason:
        `作業単位マーカーが指すリポジトリが無い（${repo} → ${repoPath}）。` +
        "**そこへ書くと、`invariants` が見ない場所に記録が作られる。** 起点と repo を確かめること",
    };
  }

  return { item: { workItemId, repoPath }, unattributedReason: null };
}

/**
 * 現在の作業単位を読む。
 *
 * **見つからない場合は null を返し、呼び出し側はそれを記録を捨てないこと。**
 * 理由まで要る場合は `resolveWorkItem` を使う。
 */
export function currentWorkItem(root) {
  return resolveWorkItem(root).item;
}

/**
 * リポジトリ名から作業ツリーの位置を求める。work 自身は直下ではなく起点そのもの。
 *
 * **比べる前に、起点を絶対パスへ直す。** `--root .` のような相対パスだと
 * `basename(".")` は `"."` であり、「起点そのものが対象リポジトリ」の判定が外れる。
 * 外れると起点の下をもう一段掘り、**存在しない入れ子へ記録を書く**（AUT-143）。
 *
 * `--root` の説明は「記録の起点。既定は CLAUDE_PROJECT_DIR かカレントディレクトリ」
 * であり、`.` を渡すのは自然な使い方である。**受け取り方の側で吸収する。**
 */
export function resolveRepo(root , repo) {
  const base = resolve(root);
  return repo === basename(base) ? base : join(base, repo);
}

export function cursorPath(root , sessionId) {
  // セッション識別子はパスの一部になるため、区切り文字を含む値を弾く。
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(root, STATE_DIR, "cursors", `${safe}.json`);
}

export function readCursor(path) {
  if (!existsSync(path)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed.lines === "number" && parsed.lines >= 0 ? parsed.lines : 0;
  } catch {
    return 0;
  }
}

export function writeCursor(path , lines , lastUuid) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ lines, last_uuid: lastUuid })}\n`, "utf8");
}

/**
 * 記録の追記先。作業単位が解決できない場合の行き先もここで決める。
 *
 * **絶対パスで返す。** 相対で返すと、書けた先が本当に意図した場所かを、出力を見た
 * 人が確かめられない。実際に `autodrive-dev-work/telemetry/...` と表示され、
 * 起点そのものだと読めてしまった（AUT-143）。
 */
export function telemetryPath(root , item) {
  if (item === null) return join(resolve(root), "telemetry", "unattributed.jsonl");
  return join(item.repoPath, "telemetry", `${item.workItemId}.jsonl`);
}

export function appendEvent(path , event) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}
