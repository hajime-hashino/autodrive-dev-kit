/**
 * Tracker ポートの入口。
 *
 * 呼び出し側は実装名を知らない。「作業単位を起票する」としか言わない。
 *
 * 着手（started へ進める）は、記録の紐づけの起点でもある。作業単位マーカーを
 * ここで書くことで、着手していない状態で記録が発生したら検出できる。
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LinearTracker } from "./adapters/trackerLinear.ts";
import { isWorkItemState } from "./ports/tracker.ts";
import type { TrackerPort, WorkItemState } from "./ports/tracker.ts";
import { STATE_DIR, currentWorkItem } from "./workItem.ts";

const USAGE = `作業単位を扱う

  tracker 作業単位を取得する [<ID>]
  tracker 作業単位を起票する --title <題> --body <本文>
  tracker 状態を進める <ID> --to <状態> [--repo <対象リポジトリ>]
  tracker 経過を追記する <ID> --text <内容>

  状態: backlog / todo / started / done / canceled
  --repo は started へ進めるときに必須。記録の書き込み先になる。

資格情報は環境変数 LINEAR_API_KEY から読む。対象が複数ある場合は
AUTODRIVE_TRACKER_TEAM で指定する。`;

export const OPERATIONS: Record<string, "get" | "create" | "advance" | "note"> = {
  作業単位を取得する: "get",
  作業単位を起票する: "create",
  状態を進める: "advance",
  経過を追記する: "note",
  get: "get",
  create: "create",
  advance: "advance",
  note: "note",
};

export function markerPath(root: string): string {
  return join(root, STATE_DIR, "current-work-item.json");
}

/** 着手した作業単位を記録の紐づけ先として置く。 */
export function writeMarker(root: string, workItemId: string, repo: string): void {
  const path = markerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ work_item_id: workItemId, repo })}\n`, "utf8");
}

/** 閉じた作業単位のマーカーを外す。別の作業単位の記録が紛れ込むのを防ぐ。 */
export function clearMarker(root: string, workItemId: string): boolean {
  const current = currentWorkItem(root);
  if (current === null || current.workItemId !== workItemId) return false;
  const path = markerPath(root);
  if (existsSync(path)) rmSync(path);
  return true;
}

export async function run(
  argv: string[],
  root: string,
  tracker: TrackerPort,
): Promise<{ output: string; code: number }> {
  const operation = OPERATIONS[argv[0] ?? ""];
  if (operation === undefined) return { output: USAGE, code: argv.length === 0 ? 0 : 2 };

  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: {
      title: { type: "string" },
      body: { type: "string" },
      to: { type: "string" },
      repo: { type: "string" },
      text: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const id = positionals[0];

  if (operation === "get") {
    const item = await tracker.get(id);
    if (item === null) return { output: "該当する作業単位が無い", code: 1 };
    return { output: `${item.id} [${item.state}] ${item.title}\n${item.url}\n\n${item.body}`, code: 0 };
  }

  if (operation === "create") {
    if ((values.title ?? "").trim() === "") return { output: "--title は必須", code: 2 };
    if ((values.body ?? "").trim() === "") return { output: "--body は必須", code: 2 };
    const item = await tracker.create({ title: values.title as string, body: values.body as string });
    return { output: `起票した: ${item.id}\n${item.url}`, code: 0 };
  }

  if (id === undefined) return { output: "作業単位のIDが要る", code: 2 };

  if (operation === "note") {
    if ((values.text ?? "").trim() === "") return { output: "--text は必須", code: 2 };
    await tracker.note(id, values.text as string);
    return { output: `追記した: ${id}`, code: 0 };
  }

  const to = values.to ?? "";
  if (!isWorkItemState(to)) return { output: "--to は backlog / todo / started / done / canceled", code: 2 };
  const target = to as WorkItemState;

  if (target === "started" && (values.repo ?? "").trim() === "") {
    // 着手は記録の紐づけの起点であり、書き込み先が決まらないと成立しない。
    return { output: "started へ進めるには --repo が要る（記録の書き込み先になる）", code: 2 };
  }

  const item = await tracker.advance(id, target);
  let note = "";
  if (target === "started") {
    writeMarker(root, item.id, values.repo as string);
    note = `\n以降の記録は ${values.repo} の ${item.id} に紐づく`;
  } else if (target === "done" || target === "canceled") {
    if (clearMarker(root, item.id)) note = "\n作業単位マーカーを外した";
  }
  return { output: `${item.id} を ${target} へ進めた${note}`, code: 0 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const token = process.env.LINEAR_API_KEY;
  const argv = process.argv.slice(2);
  if (token === undefined && OPERATIONS[argv[0] ?? ""] !== undefined) {
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
