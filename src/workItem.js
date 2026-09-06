/**
 * 現在の作業単位の解決と、記録の置き場所。
 *
 * 使用量を作業単位へ紐づける手段。セッション記録の `gitBranch` は全行 `HEAD` で
 * 固定されており（セッション開始時に1度だけ記録される）、ブランチ名から引く案は
 * 成立しない。したがって明示的なマーカーを置く。
 *
 * マーカーは作業状態であって成果物ではないため、リポジトリには入れない。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** 作業状態の置き場所。work リポジトリ直下、追跡対象外。 */
export const STATE_DIR = ".autodrive";

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
export function resolveWorkItem(root) {
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
  // 指す先が存在しなくても**「記録した」と表示されて成功に見える。** 判定器が
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
        "**そこへ書くと、判定器が見ない場所に記録が作られる。** 起点と repo を確かめること",
    };
  }

  return { item: { workItemId, repoPath }, unattributedReason: null };
}

/**
 * 現在の作業単位を読む。
 *
 * **見つからない場合は null を返し、呼び出し側はそれを握りつぶさないこと。**
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
