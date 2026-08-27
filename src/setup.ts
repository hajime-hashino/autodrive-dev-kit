/**
 * `init` / `apply` / `update`。
 *
 * **違うのは構成をどう決めるかだけで、置く手順は同じ。**
 *
 *   init    構成がまだ無い          人に聞く
 *   apply   構成がまだ無く、中身がある  見て推測し、人が確かめる
 *   update  構成が既にある          聞かない。記録されたもので置き直す
 *
 * **前提が崩れていれば置かずに止まる。** どれを打てばよいかまで出す。3つの
 * 違いを人に覚えさせない（作業ルール「停止するときの作法」）。
 */

import { execFileSync } from "node:child_process";
import { init } from "./init.ts";
import type { InitResult } from "./init.ts";
import {
  CONFIG_FILE,
  NONE,
  PORT_NAMES,
  defaults,
  hasConfig,
  infer,
  readConfig,
  writeConfig,
} from "./config.ts";
import type { Config, PortName } from "./config.ts";
import type { InterviewPort, Question } from "./ports/interview.ts";

export type Mode = "init" | "apply" | "update";

export interface SetupResult extends InitResult {
  config: Config | null;
  /** 構成をどう決めたか。**人に見せる。** 推奨で進んだ場合もここに出る。 */
  decisions: string[];
}

/**
 * 聞くこと。
 *
 * **選択肢が1つしか無いものは聞かない。** 聞いても選べないものを並べると、
 * 人は答えを持たない問いに時間を使うことになる。選べるようになったら、
 * ここに増える（`PORT_CHOICES`）。
 *
 * **専門語で聞かない。** 前提知識を要求する問いかけは、人のスキルレベルに
 * よらず開発できるという前提を損なう。
 */
export const QUESTIONS: ReadonlyArray<Question & { port: PortName }> = [
  {
    port: "preview",
    ask: "提出のたびに、動くものを見られる場所を用意しますか？",
    why: "画面の見え方は、動くものを見ないと決められません。用意すると、提出ごとに URL が出ます。",
    choices: [
      { value: "cloudflare-workers", label: "用意する（Cloudflare Workers）" },
      { value: NONE, label: "用意しない（画面の無いものを作る、あとで決める）" },
    ],
    recommended: "cloudflare-workers",
  },
  {
    port: "sandbox",
    ask: "AIを、隔離された作業場の中で動かしますか？",
    why: "手元の環境から切り離すと、消してはいけないものへ手が届かなくなります。",
    choices: [
      { value: "devcontainer", label: "隔離する（devcontainer）" },
      { value: NONE, label: "隔離しない" },
    ],
    recommended: "devcontainer",
  },
];

/**
 * 聞かなかったポートを記録する。
 *
 * **一行につき一つの理由。** 同じポートが2回出ると、どちらが本当か読む側が
 * 決めることになる。見て分かったならその根拠、そうでなければ選択肢が1つだから。
 */
function fixedPorts(config: Config, because: Partial<Record<PortName, string>>): string[] {
  const asked = new Set(QUESTIONS.map((q) => q.port));
  return PORT_NAMES.filter((p) => !asked.has(p)).map((p) => {
    const why = because[p] !== undefined ? `見て分かった: ${because[p]}` : "選択肢が1つ";
    return `${p}: ${config.ports[p]}（${why}）`;
  });
}

/**
 * 聞いて決める。
 *
 * **推奨は、いま分かっていることから作る。** 既にあるものを見て推測できたなら、
 * それが推奨になる。静的な推奨を出すと、見て分かったことを人に否定させることになる。
 *
 * **推測できていないものに、既定を推奨として出さない。** 構成の既定値（`defaults`）は
 * 「聞かないポートの初期値」であって、推奨ではない。混ぜると、聞いているのに
 * 既定へ倒れる。
 */
function interview(
  interviewer: InterviewPort,
  known: Partial<Record<PortName, string>>,
  because: Partial<Record<PortName, string>> = {},
): { config: Config; decisions: string[] } {
  const config = defaults();
  const decisions: string[] = [];

  for (const q of QUESTIONS) {
    const seen = known[q.port];
    const inferred = seen !== undefined && q.choices.some((c) => c.value === seen);
    const recommended = inferred ? (seen as string) : q.recommended;

    const answered = interviewer.answer({ ...q, recommended });
    // **黙って既定に倒れない。** 決めていないものが決めたものに見える。
    config.ports[q.port] = answered ?? recommended;

    // **どう決まったかを、決まった値の隣に置く。** 別の一覧に分けると、どの行が
    // どれの理由なのかを読む側が突き合わせることになる。
    let how = "";
    if (answered !== null) how = "（選んだもの）";
    else if (inferred) how = `（見て分かったものを採った: ${because[q.port] ?? "推測"}）`;
    else how = "（聞けなかったため推奨のまま）";

    decisions.push(`${q.port}: ${config.ports[q.port]}${how}`);
  }
  decisions.push(...fixedPorts(config, because));
  return { config, decisions };
}

function gitRemote(root: string): string | null {
  try {
    return execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function refuse(message: string): SetupResult {
  return { placed: [], todo: [], version: null, code: 1, message, config: null, decisions: [] };
}

export function setup(
  mode: Mode,
  root: string,
  kitRoot: string,
  interviewer: InterviewPort,
): SetupResult {
  const present = hasConfig(root);

  // 前提 ----------------------------------------------------------------------
  if (mode === "update" && !present) {
    return refuse(
      `${CONFIG_FILE} が無い。**このプロジェクトは、まだ土台を置いていない。**\n\n` +
        "  新しく始めるなら:            autodrive-dev-kit init\n" +
        "  既にあるものへ入れるなら:    autodrive-dev-kit apply",
    );
  }
  if (mode !== "update" && present) {
    return refuse(
      `${CONFIG_FILE} が既にある。**上書きすると、決めた内容が消える。**\n\n` +
        "  道具を新しい版へ入れ替えるなら:  autodrive-dev-kit update\n" +
        `  構成を決め直すなら:              ${CONFIG_FILE} を消してから もう一度`,
    );
  }

  // 構成を決める --------------------------------------------------------------
  let config: Config;
  let decisions: string[];

  if (mode === "update") {
    const read = readConfig(root);
    if (read.error !== null) {
      // **壊れた構成を既定で埋めない。** 決めた内容が黙って別のものに入れ替わる。
      return refuse(`${read.error}\n\n直してから、もう一度実行すること。`);
    }
    config = read.config as Config;
    decisions = PORT_NAMES.map((p) => `${p}: ${config.ports[p]}（記録されたもの）`);
  } else if (mode === "apply") {
    const { config: guessed, because } = infer(root, gitRemote(root));
    // **見て分かったものだけを推奨にする。** 見て分からなかったものまで渡すと、
    // 推測していないことを推測したかのように出すことになる。
    const seen = Object.fromEntries(
      PORT_NAMES.filter((p) => because[p] !== undefined).map((p) => [p, guessed.ports[p]]),
    );
    // **推測の根拠も渡す。** 何を見てそう言っているかが分からないと、確かめようがない。
    const merged = interview(interviewer, seen, because);
    config = merged.config;
    decisions = merged.decisions;
  } else {
    const asked = interview(interviewer, {});
    config = asked.config;
    decisions = asked.decisions;
  }

  // 置く ----------------------------------------------------------------------
  const result = init(root, kitRoot);
  if (result.message !== null) return { ...result, config: null, decisions: [] };

  // **入れ替えでは触らない。** 決めた内容はプロジェクトのものである。読んだものを
  // 書き戻すだけでも、整形の違いや、この版が知らない項目の欠落が入りうる。
  if (mode === "update") {
    result.placed.push({ path: CONFIG_FILE, placement: "skipped" });
    // 入れ替えは、既に動いているプロジェクトに対して打つ。始め方の案内は要らない。
    result.todo = result.todo.filter((t) => !t.includes("はじめる"));
  } else {
    writeConfig(root, config);
    result.placed.push({ path: CONFIG_FILE, placement: "seeded" });
  }

  return { ...result, config, decisions };
}
