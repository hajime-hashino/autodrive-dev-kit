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
import { basename, dirname, join } from "node:path";

/** 作業状態の置き場所。work リポジトリ直下、追跡対象外。 */
export const STATE_DIR = ".autodrive";

export interface WorkItem {
  workItemId: string;
  /** 記録を書き込むリポジトリ。work リポジトリ自身を指す場合もある。 */
  repoPath: string;
}

export interface WorkItemResolution {
  item: WorkItem | null;
  /** 解決できなかった理由。解決できた場合は null。 */
  unattributedReason: string | null;
}

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
export function resolveWorkItem(root: string): WorkItemResolution {
  const path = join(root, STATE_DIR, "current-work-item.json");
  if (!existsSync(path)) {
    return {
      item: null,
      unattributedReason:
        "作業単位マーカーが無い。作業単位に紐づかないやり取り（起票するかの検討など）である可能性がある",
    };
  }

  let parsed: { work_item_id?: unknown; repo?: unknown };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as typeof parsed;
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
      .filter((v): v is string => v !== null)
      .join(" / ");
    return {
      item: null,
      unattributedReason: `作業単位マーカーの内容が欠けている（${missing}）。**紐づけられたはずの記録が帰属しないまま残る**`,
    };
  }

  return { item: { workItemId, repoPath: resolveRepo(root, repo) }, unattributedReason: null };
}

/**
 * 現在の作業単位を読む。
 *
 * **見つからない場合は null を返し、呼び出し側はそれを握りつぶさないこと。**
 * 理由まで要る場合は `resolveWorkItem` を使う。
 */
export function currentWorkItem(root: string): WorkItem | null {
  return resolveWorkItem(root).item;
}

/** リポジトリ名から作業ツリーの位置を求める。work 自身は直下ではなく起点そのもの。 */
export function resolveRepo(root: string, repo: string): string {
  return repo === basename(root) ? root : join(root, repo);
}

export function cursorPath(root: string, sessionId: string): string {
  // セッション識別子はパスの一部になるため、区切り文字を含む値を弾く。
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(root, STATE_DIR, "cursors", `${safe}.json`);
}

export function readCursor(path: string): number {
  if (!existsSync(path)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { lines?: unknown };
    return typeof parsed.lines === "number" && parsed.lines >= 0 ? parsed.lines : 0;
  } catch {
    return 0;
  }
}

export function writeCursor(path: string, lines: number, lastUuid: string | null): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ lines, last_uuid: lastUuid })}\n`, "utf8");
}

/** 記録の追記先。作業単位が解決できない場合の行き先もここで決める。 */
export function telemetryPath(root: string, item: WorkItem | null): string {
  if (item === null) return join(root, "telemetry", "unattributed.jsonl");
  return join(item.repoPath, "telemetry", `${item.workItemId}.jsonl`);
}

export function appendEvent(path: string, event: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}
