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

const USAGE = `作業単位を扱う

  tracker 作業単位を取得する [<ID>]
  tracker 作業単位を起票する --title <題> --body <本文>
  tracker ステータスを進める <ID> --to <状態> [--repo <対象リポジトリ>]
  tracker 作業ログを追記する [<ID>] --text <内容>   ID を省くと、いま着手中の作業単位へ
  tracker 本文を直す <ID> --body <本文>

  状態: backlog / todo / started / done / canceled
  本文を直せるのは着手前（backlog / todo）に限る。着手後の訂正は
  「作業ログを追記する」で行う。
  --repo は started へ進めるときに必須。記録の書き込み先になる。

資格情報は環境変数 LINEAR_API_KEY から読む。対象が複数ある場合は
AUTODRIVE_TRACKER_TEAM で指定する。`;

export const OPERATIONS = {
  作業単位を取得する: "get",
  作業単位を起票する: "create",
  ステータスを進める: "advance",
  作業ログを追記する: "note",
  本文を直す: "revise",
  get: "get",
  create: "create",
  advance: "advance",
  note: "note",
  revise: "revise",
};

/** 前の名前。**当面は受け付ける。** 理由は telemetryCli.js の RENAMED に書いた。 */
export const RENAMED = {
  状態を進める: "ステータスを進める",
  経過を追記する: "作業ログを追記する",
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

export async function run(
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
    if (item === null) return { output: "該当する作業単位が無い", code: 1 };
    return { output: `${item.id} [${item.state}] ${item.title}\n${item.url}\n\n${item.body}`, code: 0 };
  }

  if (operation === "create") {
    if ((values.title ?? "").trim() === "") return { output: "--title は必須", code: 2 };
    if ((values.body ?? "").trim() === "") return { output: "--body は必須", code: 2 };
    const item = await tracker.create({ title: values.title , body: values.body });
    return { output: `起票した: ${item.id}\n${item.url}`, code: 0 };
  }

  // **作業ログは、ID を省けば着手中の作業単位へ書く。** 止まって人が答えるたびに
  // 書くものであり、毎回 ID を引かせると書かれなくなる（AUT-258）。記録と同じ
  // 解決の仕方をとるので、書いた先がテレメトリとずれない。
  if (operation === "note") {
    if ((values.text ?? "").trim() === "") return { output: "--text は必須", code: 2 };
    const target = id ?? resolveWorkItem(root).item?.workItemId;
    if (target === undefined) {
      return { output: "着手中の作業単位が無い。ID を渡すこと（先に begin で着手する）", code: 2 };
    }
    await tracker.note(target, values.text);
    return { output: `追記した: ${target}`, code: 0 };
  }

  if (id === undefined) return { output: "作業単位のIDが要る", code: 2 };

  // **本文を直せるのは着手前に限る**（定義§16）。
  //
  // 着手後の本文は「何を頼まれたか」の記録であり、書き換えられる形にすると
  // **「頼まれたとおり作ったか」を確かめられなくなる。**
  //
  // **規則はここにある。アダプタには置かない。** 実装が増えたときに片方だけ
  // 緩くなる。
  if (operation === "revise") {
    if ((values.body ?? "").trim() === "") return { output: "--body は必須", code: 2 };
    const current = await tracker.get(id);
    if (current === null) return { output: "該当する作業単位が無い", code: 1 };
    if (!isRevisable(current.state)) {
      // **何をすればよいかまで出す。** 断るだけでは、訂正の行き先が分からない。
      return {
        output:
          `${current.id} は ${current.state} であり、本文を直せない` +
          `（直せるのは ${REVISABLE_STATES.join(" / ")}）。\n` +
          "**着手後の本文は「何を頼まれたか」の記録である。**\n" +
          `訂正は作業ログへ: tracker 作業ログを追記する ${current.id} --text "..."`,
        code: 2,
      };
    }
    const item = await tracker.revise(id, values.body);
    return { output: `本文を直した: ${item.id}\n${item.url}`, code: 0 };
  }

  const to = values.to ?? "";
  if (!isWorkItemState(to)) return { output: "--to は backlog / todo / started / done / canceled", code: 2 };
  const target = to;

  if (target === "started" && (values.repo ?? "").trim() === "") {
    // 着手は記録の紐づけの起点であり、書き込み先が決まらないと成立しない。
    return { output: "started へ進めるには --repo が要る（記録の書き込み先になる）", code: 2 };
  }

  // **対象リポジトリを Tracker にも渡す。** 手元のマーカーにしか書かないと、
  // 一覧を見てもどれがどのリポジトリの作業か分からない（AUT-114）。
  const item = await tracker.advance(id, target, values.repo);
  let note = "";
  if (target === "started") {
    writeMarker(root, item.id, values.repo);
    note = `\n以降の記録は ${values.repo} の ${item.id} に紐づく`;
  } else if (target === "done" || target === "canceled") {
    if (clearMarker(root, item.id)) note = "\n作業単位マーカーを外した";
  }
  return { output: `${item.id} を ${target} へ進めた${note}`, code: 0 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const root = defaultRoot();
  const argv = process.argv.slice(2);
  // **構成に書かれた実装で組み立てる。** 実装名をここに書かない（定義§16）。
  const { tracker, error } = createTracker(root);
  if (tracker === null && OPERATIONS[argv[0] ?? ""] !== undefined) {
    console.error(error ?? "Tracker を組み立てられない");
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
