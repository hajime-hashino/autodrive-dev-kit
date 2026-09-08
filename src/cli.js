/**
 * 入口。
 *
 * **PATH に入れて増えるものを1つにする。** コマンドごとに実行ファイルを置くと、
 * 使う人の PATH にコマンドの数だけ生える。使う人が打つのは `init` だけであり、
 * 残りはAIが打つ。
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setup } from "./setup.js";

import { terminalInterview } from "./adapters/interviewTerminal.js";
import { say } from "./messages.js";


const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `AIに開発を任せて回すための autodrive-dev-kit

  autodrive-dev-kit init                    新しく始める。構成を聞いて、土台を置く
  autodrive-dev-kit apply                   既にあるものへ入れる。構成を推測して確かめる

AIが使うもの（人は打たなくてよい）

  autodrive-dev-kit update                  新しいバージョンへ入れ替える。構成は聞かない
  autodrive-dev-kit begin <ID> --repo <先>  着手する
  autodrive-dev-kit tracker <操作> ...      作業単位を扱う
  autodrive-dev-kit telemetry <操作> ...    記録する
  autodrive-dev-kit invariants [--root <場所>]  不変条件の状態を判定する
  autodrive-dev-kit reconcile [--dry-run]   統合された作業単位を完了にする（begin が兼ねる）

使い方の全体は README を参照。`;

/** 下位の入口。**引数はそのまま渡す。** ここで解釈すると二重に持つことになる。 */
const DELEGATES = {
  begin: "beginCli.js",
  tracker: "trackerCli.js",
  telemetry: "telemetryCli.js",
  reconcile: "reconcileCli.js",
  invariants: "main.js",
  // **旧名。invariants と同じものを指す。** 既に配線されている CI が呼んでいる。
  verify: "main.js",
};

export function delegateFor(command) {
  if (command === undefined) return null;
  return DELEGATES[command] ?? null;
}

export const MODES = new Set (["init", "apply", "update"]);



export function renderSetup(mode , result) {
  if (result.message !== null) return { output: result.message, code: result.code };

  // **決まった言語で出す。** 決まっていなければ既定で出す。
  const language = result.config?.language ?? "ja";
  const t = (key, values) => say(language, key, values);

  const lines = [t(`headline.${mode}`, { version: result.version ?? "?" }), ""];
  for (const p of result.placed) {
    lines.push(`  ${p.path.padEnd(34)} ${t(`placement.${p.placement}`)}`);
  }

  // **何をどう決めたかを出す。** 出さないと、聞かれなかった項目が決まっている
  // ことに気づけない。
  if (result.decisions.length > 0) {
    lines.push("", t("section.config"), "");
    for (const d of result.decisions) lines.push(`  ${d}`);
  }

  // **確かめられなかったことを、置いたものの直後に出す。** 後ろに回すと、
  // 人にしかできないことの一覧に紛れて読み飛ばされる。
  for (const note of result.notes ?? []) lines.push("", note);

  if (result.todo.length > 0) {
    lines.push("", t("section.todo"), "");
    result.todo.forEach((t2, i) => lines.push(`  ${i + 1}. ${t2}`));
  }

  return { output: lines.join("\n"), code: 0 };
}

export function runSetup(
  mode ,
  root ,
  interviewer = terminalInterview(),
) {
  return renderSetup(mode, setup(mode, root, KIT_ROOT, interviewer));
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (MODES.has(command)) {
    const { output, code } = runSetup(command , process.cwd());
    (code === 0 ? console.log : console.error)(output);
    process.exit(code);
  }

  const delegate = delegateFor(command);
  if (delegate === null) {
    console.error(`知らない操作: ${command}\n\n${USAGE}`);
    process.exit(2);
  }

  // **子として起動する。** 取り込むと、下位が process.exit する前提と噛み合わない。
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [resolve(KIT_ROOT, "src", delegate), ...argv.slice(1)],
    { stdio: "inherit", env: process.env },
  );
  process.exit(result.status ?? 1);
}
