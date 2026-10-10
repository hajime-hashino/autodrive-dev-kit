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
import { argumentInterview, readAnswers } from "./adapters/interviewArguments.js";
import { say, DEFAULT_LANGUAGE } from "./messages.js";


/**
 * 実行するものの根。**複製先ではここが `autodrive/` になる。**
 *
 * 複製は `src/vendored/` の中身を直下へ展開したものなので、ここから見た殻・実装の
 * 位置は、参照実装の中でも複製先でも同じである。
 */
const RUN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 参照実装の根。テンプレートはここから探す。
 *
 * **複製先では、ここは参照実装を指さない。** 複製は階層を1つ潰して展開されるため、
 * 同じ辿り方では別の場所に出る。それでよい——**複製先からは生成できない**のが
 * 決めたことであり（ADR 0004）、`setup` がテンプレートの不在を見て止める。
 */
const KIT_ROOT = resolve(RUN_ROOT, "..", "..");

const USAGE = `autodrive-dev-kit: hand development to an AI and keep it running

  autodrive-dev-kit init                    Start new. Asks about the setup and places the foundation
  autodrive-dev-kit apply                   Add to an existing project. Infers the setup and confirms it

  Answers can also be given as arguments, for when there is no terminal to ask on:
    --language <ja|en> --tracker <...> --preview <...> --sandbox <...> --prefix <...>
  What is not given is asked as usual.

Used by the AI (humans do not need to run these)

  autodrive-dev-kit update                  Replace with a newer version. Does not ask about the setup
  autodrive-dev-kit begin <ID> --repo <target>  Start work
  autodrive-dev-kit tracker <operation> ...     Handle work items
  autodrive-dev-kit telemetry <operation> ...   Record
  autodrive-dev-kit sandbox <operation> ...     Check the egress
  autodrive-dev-kit env check <NAME>...         Check credentials are set, without printing them
  autodrive-dev-kit invariants [--root <path>]  Judge the state of the invariants
  autodrive-dev-kit quality [--root <path>]     Produce the quality evidence

See the README for full usage.`;

/** 下位の入口。**引数はそのまま渡す。** ここで解釈すると二重に持つことになる。 */
const DELEGATES = {
  begin: "beginCli.js",
  tracker: "trackerCli.js",
  telemetry: "telemetryCli.js",
  sandbox: "sandboxCli.js",
  env: "envCli.js",
  invariants: "main.js",
  quality: "qualityCli.js",
};

export function delegateFor(command) {
  if (command === undefined) return null;
  return DELEGATES[command] ?? null;
}

export const MODES = new Set (["init", "apply", "update"]);



export function renderSetup(mode , result) {
  if (result.message !== null) return { output: result.message, code: result.code };

  // **決まった言語で出す。** 決まっていなければ既定で出す。
  const language = result.config?.language ?? DEFAULT_LANGUAGE;
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

/**
 * @param {string[]} args 構成への答え（`--tracker linear` など）
 */
export function runSetup(
  mode ,
  root ,
  interviewer = terminalInterview(),
  args = [],
) {
  // **入れ替えは聞かない。** 答えを受け取っても使う場所が無い。黙って捨てると、
  // 構成を変えたつもりの人が変わっていないことに気づけない。
  if (mode === "update" && args.length > 0) {
    return {
      output:
        `update does not take answers (${args.join(" ")}). **It does not ask about the setup.**\n\n` +
        "To change the setup, edit autodrive.json, then run update.",
      code: 2,
    };
  }

  const { answers, error } = readAnswers(args);
  if (error !== null) return { output: error, code: 2 };

  const asked = argumentInterview(answers, interviewer);
  const result = setup(mode, root, KIT_ROOT, asked);
  const rendered = renderSetup(mode, result);
  if (rendered.code !== 0) return rendered;

  // **渡したのに使われなかった答えを出す。** 出さないと、効いたように見える。
  const unused = asked.unused();
  if (unused.length === 0) return rendered;
  const language = result.config?.language ?? DEFAULT_LANGUAGE;
  const note = say(language, "note.unusedAnswers", { names: unused.map((n) => `--${n}`).join(" ") });
  return { ...rendered, output: `${rendered.output}\n\n${note}` };
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
    const { output, code } = runSetup(command , process.cwd(), undefined, argv.slice(1));
    (code === 0 ? console.log : console.error)(output);
    process.exit(code);
  }

  const delegate = delegateFor(command);
  if (delegate === null) {
    console.error(`Unknown operation: ${command}\n\n${USAGE}`);
    process.exit(2);
  }

  // **子として起動する。** 取り込むと、下位が process.exit する前提と噛み合わない。
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [resolve(RUN_ROOT, "internal", delegate), ...argv.slice(1)],
    { stdio: "inherit", env: process.env },
  );
  process.exit(result.status ?? 1);
}
