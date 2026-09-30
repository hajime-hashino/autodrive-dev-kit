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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createTracker } from "./ports/trackerFactory.js";
import { REVISABLE_STATES, isRevisable, isWorkItemState } from "./ports/tracker.js";

import { STATE_DIR, defaultRoot, resolveWorkItem } from "./workItem.js";

const USAGE = `Handle work items

  tracker get-work-item [<ID>]
  tracker file-work-item --title <title> --body <body>
  tracker advance-status <ID> --to <state> [--repo <target repository>]
  tracker append-to-work-log [<ID>] --text <text>   Without an ID, to the work item currently started
  tracker edit-work-item-body <ID> --body <body>

  States: backlog / todo / started / done / canceled
  The body can be edited only before work starts (backlog / todo). Corrections after
  work starts are made with append-to-work-log.
  --repo is required when advancing to started. It is where records are written.

Credentials are read from the environment variable LINEAR_API_KEY. If there are several targets,
specify one with AUTODRIVE_TRACKER_TEAM.

The Japanese names of earlier versions (作業単位を起票する, 作業ログを追記する, ...) are still accepted.`;

// **英語の操作名をハイフンでつないだ形を正とする**（AUT-267）。
export const OPERATIONS = {
  "get-work-item": "get",
  "file-work-item": "create",
  "advance-status": "advance",
  "append-to-work-log": "note",
  "edit-work-item-body": "revise",
  get: "get",
  create: "create",
  advance: "advance",
  note: "note",
  revise: "revise",
};

/** 前の名前。**当面は受け付ける。** 理由は telemetryCli.js の RENAMED に書いた。 */
export const RENAMED = {
  // 定義 v0.19 で英語になった（AUT-267）。
  作業単位を取得する: "get-work-item",
  作業単位を起票する: "file-work-item",
  ステータスを進める: "advance-status",
  作業ログを追記する: "append-to-work-log",
  本文を直す: "edit-work-item-body",
  // さらに前の名前。
  状態を進める: "advance-status",
  経過を追記する: "append-to-work-log",
};

export function markerPath(root) {
  return join(root, STATE_DIR, "current-work-item.json");
}

/** 着手した作業単位を記録の紐づけ先として置く。 */
export function writeMarker(root , workItemId , repo) {
  const path = markerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ work_item_id: workItemId, repo })}\n`, "utf8");
}

/**
 * 閉じた作業単位のマーカーを外す。別の作業単位の記録が紛れ込むのを防ぐ。
 *
 * **マーカーの中身だけを見る。置き場所の解決に依存しない。** 解決は対象リポジトリの
 * 作業ツリーが在ることを求めるようになった（AUT-143）。それに依存すると、**指す先が
 * 無いマーカーを外せなくなり、次の作業の記録が前の作業単位へ紛れ込み続ける。**
 * 外すのに要るのは作業単位IDの一致だけである。
 */
export function clearMarker(root , workItemId) {
  const path = markerPath(root);
  if (!existsSync(path)) return false;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  if (parsed?.work_item_id !== workItemId) return false;
  rmSync(path);
  return true;
}

/**
 * **古い名前で呼ばれたら、新しい名前を出す**（AUT-267）。黙って受け入れると、いつまでも
 * 2つの名前が生き続ける。telemetry と同じ扱いにする。
 */
export async function run(argv , root , tracker ) {
  const given = argv[0] ?? "";
  const result = await dispatch(argv, root, tracker);
  const renamedTo = RENAMED[given];
  if (renamedTo === undefined) return result;
  return { ...result, output: `${result.output}\n("${given}" has been renamed to "${renamedTo}". Use that from now on)` };
}

async function dispatch(
  argv ,
  root ,
  tracker ,
) {
  const given = argv[0] ?? "";
  const renamedTo = RENAMED[given];
  const operation = OPERATIONS[given] ?? (renamedTo === undefined ? undefined : OPERATIONS[renamedTo]);
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
    if (item === null) return { output: "No matching work item", code: 1 };
    return { output: `${item.id} [${item.state}] ${item.title}\n${item.url}\n\n${item.body}`, code: 0 };
  }

  if (operation === "create") {
    if ((values.title ?? "").trim() === "") return { output: "--title is required", code: 2 };
    if ((values.body ?? "").trim() === "") return { output: "--body is required", code: 2 };
    const item = await tracker.create({ title: values.title , body: values.body });
    return { output: `Filed: ${item.id}\n${item.url}`, code: 0 };
  }

  // **作業ログは、ID を省けば着手中の作業単位へ書く。** 止まって人が答えるたびに
  // 書くものであり、毎回 ID を引かせると書かれなくなる（AUT-258）。記録と同じ
  // 解決の仕方をとるので、書いた先がテレメトリとずれない。
  if (operation === "note") {
    if ((values.text ?? "").trim() === "") return { output: "--text is required", code: 2 };
    const target = id ?? resolveWorkItem(root).item?.workItemId;
    if (target === undefined) {
      return { output: "No work item is currently started. Pass an ID (or start one with begin first)", code: 2 };
    }
    await tracker.note(target, values.text);
    return { output: `Appended: ${target}`, code: 0 };
  }

  if (id === undefined) return { output: "A work item ID is required", code: 2 };

  // **本文を直せるのは着手前に限る**（定義§16）。
  //
  // 着手後の本文は「何を頼まれたか」の記録であり、書き換えられる形にすると
  // **「頼まれたとおり作ったか」を確かめられなくなる。**
  //
  // **規則はここにある。アダプタには置かない。** 実装が増えたときに片方だけ
  // 緩くなる。
  if (operation === "revise") {
    if ((values.body ?? "").trim() === "") return { output: "--body is required", code: 2 };
    const current = await tracker.get(id);
    if (current === null) return { output: "No matching work item", code: 1 };
    if (!isRevisable(current.state)) {
      // **何をすればよいかまで出す。** 断るだけでは、訂正の行き先が分からない。
      return {
        output:
          `${current.id} is ${current.state}, so its body cannot be edited` +
          ` (it can be edited in ${REVISABLE_STATES.join(" / ")}).\n` +
          "**After work starts, the body is the record of \"what was asked for.\"**\n" +
          `Put corrections in the work log: tracker append-to-work-log ${current.id} --text "..."`,
        code: 2,
      };
    }
    const item = await tracker.revise(id, values.body);
    return { output: `Edited the body: ${item.id}\n${item.url}`, code: 0 };
  }

  const to = values.to ?? "";
  if (!isWorkItemState(to)) return { output: "--to must be backlog / todo / started / done / canceled", code: 2 };
  const target = to;

  if (target === "started" && (values.repo ?? "").trim() === "") {
    // 着手は記録の紐づけの起点であり、書き込み先が決まらないと成立しない。
    return { output: "Advancing to started needs --repo (it is where records are written)", code: 2 };
  }

  // **対象リポジトリを Tracker にも渡す。** 手元のマーカーにしか書かないと、
  // 一覧を見てもどれがどのリポジトリの作業か分からない（AUT-114）。
  const item = await tracker.advance(id, target, values.repo);
  let note = "";
  if (target === "started") {
    writeMarker(root, item.id, values.repo);
    note = `\nRecords from now on are linked to ${item.id} in ${values.repo}`;
  } else if (target === "done" || target === "canceled") {
    if (clearMarker(root, item.id)) note = "\nRemoved the work item marker";
  }
  return { output: `Advanced ${item.id} to ${target}${note}`, code: 0 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const root = defaultRoot();
  const argv = process.argv.slice(2);
  // **構成に書かれた実装で組み立てる。** 実装名をここに書かない（定義§16）。
  const { tracker, error } = createTracker(root);
  if (tracker === null && OPERATIONS[argv[0] ?? ""] !== undefined) {
    console.error(error ?? "Cannot build the Tracker");
    process.exit(2);
  }
  try {
    const { output, code } = await run(argv, root, tracker);
    (code === 0 ? console.log : console.error)(output);
    process.exit(code);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
