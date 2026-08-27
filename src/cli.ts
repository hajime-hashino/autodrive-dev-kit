/**
 * 入口。
 *
 * **PATH に入れて増えるものを1つにする。** 道具ごとに実行ファイルを置くと、
 * 使う人の PATH に道具の数だけ生える。使う人が打つのは `init` だけであり、
 * 残りはAIが打つ。
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "./init.ts";

const KIT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `AIに開発を任せて回すための道具一式

  autodrive-dev-kit init                    このプロジェクトに土台を置く

AIが使うもの（人は打たなくてよい）

  autodrive-dev-kit begin <ID> --repo <先>  着手する
  autodrive-dev-kit tracker <操作> ...      作業単位を扱う
  autodrive-dev-kit telemetry <操作> ...    記録する
  autodrive-dev-kit verify [--root <場所>]  決めたことが守られているかを判定する

使い方の全体は README を参照。`;

/** 下位の入口。**引数はそのまま渡す。** ここで解釈すると二重に持つことになる。 */
const DELEGATES: Record<string, string> = {
  begin: "beginCli.ts",
  tracker: "trackerCli.ts",
  telemetry: "telemetryCli.ts",
  verify: "main.ts",
};

export function delegateFor(command: string | undefined): string | null {
  if (command === undefined) return null;
  return DELEGATES[command] ?? null;
}

export function runInit(root: string): { output: string; code: number } {
  const result = init(root, KIT_ROOT);
  if (result.message !== null) return { output: result.message, code: result.code };

  const label: Record<string, string> = {
    managed: "置いた（参照実装が管理する。次に入れ替えると上書きされる）",
    seeded: "置いた（このプロジェクトのものになる）",
    merged: "足した",
    skipped: "そのままにした（既にある）",
  };

  const lines = [`土台を置いた（版 ${result.version ?? "不明"}）。`, ""];
  for (const p of result.placed) lines.push(`  ${p.path.padEnd(34)} ${label[p.placement]}`);

  lines.push("", "**ここから先は人にしかできない。**", "");
  result.todo.forEach((t, i) => lines.push(`  ${i + 1}. ${t}`));

  return { output: lines.join("\n"), code: 0 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === undefined || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === "init") {
    const { output, code } = runInit(process.cwd());
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
