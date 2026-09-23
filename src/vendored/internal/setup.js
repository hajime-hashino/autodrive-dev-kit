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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TEMPLATES_DIR, init } from "./init.js";
import { LANGUAGES, say } from "./messages.js";

import {
  CONFIG_FILE,
  NONE,
  PORT_NAMES,
  defaults,
  hasConfig,
  infer,
  readConfig,
  writeConfig,
} from "./config.js";

/** @typedef {"init" | "apply" | "update"} Mode */
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
/**
 * 聞くこと。**言語ごとに組み立てる。**
 *
 * **選択肢が1つしか無いものは聞かない。** 聞いても選べないものを並べると、
 * 人は答えを持たない問いに時間を使うことになる。選べるようになったら、
 * ここに増える（`PORT_CHOICES`）。
 *
 * **専門語で聞かない。** 前提知識を要求する問いかけは、人のスキルレベルに
 * よらず開発できるという前提を損なう。
 *
 * @param {"ja" | "en"} language
 */
export function questionsFor(language) {
  const t = (key, values) => say(language, key, values);
  return [
    {
      port: "preview",
      language,
      ask: t("ask.preview"),
      why: t("ask.preview.why"),
      choices: [
        { value: "cloudflare-workers", label: t("ask.preview.cloudflare") },
        { value: NONE, label: t("ask.preview.none") },
      ],
      recommended: "cloudflare-workers",
    },
    {
      port: "sandbox",
      language,
      ask: t("ask.sandbox"),
      why: t("ask.sandbox.why"),
      choices: [
        { value: "devcontainer", label: t("ask.sandbox.devcontainer") },
        { value: "orca", label: t("ask.sandbox.orca") },
        { value: "other", label: t("ask.sandbox.other") },
        { value: NONE, label: t("ask.sandbox.none") },
      ],
      recommended: "devcontainer",
    },
  ];
}

/**
 * 言語を聞く。**いちばん先に聞く。** ここで決まった言語で、以降の質問を出す。
 *
 * **どの言語でも読める形で出す。** まだ相手の言語が分からないため、選択肢は
 * それぞれの言語で書く。
 */
export const LANGUAGE_QUESTION = {
  ask: `${say("ja", "ask.language")} / ${say("en", "ask.language")}`,
  why: `${say("ja", "ask.language.why")}\n  ${say("en", "ask.language.why")}`,
  choices: LANGUAGES.map((l) => ({ value: l, label: say(l, `ask.language.${l}`) })),
  recommended: "ja",
};

/** 既定の言語で聞くこと。**古い呼び出しのために残す。** */
export const QUESTIONS = questionsFor("ja");


/**
 * 聞かなかったポートを記録する。
 *
 * **一行につき一つの理由。** 同じポートが2回出ると、どちらが本当か読む側が
 * 決めることになる。見て分かったならその根拠、そうでなければ選択肢が1つだから。
 */
function fixedPorts(config , because) {
  const language = config.language;
  const asked = new Set(questionsFor(language).map((q) => q.port));
  return PORT_NAMES.filter((p) => !asked.has(p)).map((p) => {
    const how =
      because[p] !== undefined
        ? say(language, "decided.seen", { because: because[p] })
        : say(language, "decided.onlyOne");
    return `${p}: ${config.ports[p]}${how}`;
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
  interviewer ,
  known ,
  because = {},
) {
  const config = defaults();
  const decisions = [];

  // **いちばん先に言語を聞く。** ここで決まった言語で、以降の質問を出す。
  const language = interviewer.answer(LANGUAGE_QUESTION) ?? LANGUAGE_QUESTION.recommended;
  config.language = language;

  for (const q of questionsFor(language)) {
    const seen = known[q.port];
    const inferred = seen !== undefined && q.choices.some((c) => c.value === seen);
    const recommended = inferred ? (seen) : q.recommended;

    const answered = interviewer.answer({ ...q, recommended });
    // **黙って既定に倒れない。** 決めていないものが決めたものに見える。
    config.ports[q.port] = answered ?? recommended;

    // **どう決まったかを、決まった値の隣に置く。** 別の一覧に分けると、どの行が
    // どれの理由なのかを読む側が突き合わせることになる。
    let how = "";
    if (answered !== null) how = say(language, "decided.chosen");
    else if (inferred) how = say(language, "decided.inferred", { because: because[q.port] ?? "" });
    else how = say(language, "decided.recommended");

    decisions.push(`${q.port}: ${config.ports[q.port]}${how}`);
  }
  decisions.push(...fixedPorts(config, because));
  return { config, decisions };
}

function gitRemote(root) {
  try {
    return execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function refuse(message) {
  return { placed: [], todo: [], notes: [], version: null, code: 1, message, config: null, decisions: [] };
}

/** 外から取ってくるときの打ち方。**README と同じものを指す。** */
export const FROM_SOURCE = "npx github:hajimegane/autodrive-dev-kit";

/**
 * ここから置けるか。
 *
 * **プロジェクトの中のコピーからは置けない。** コピーにはテンプレートが入って
 * いない（[ADR 0004](../docs/adr/0004-vendored-kit.md)）。置く処理はテンプレートを
 * 読んでファイルを作るため、無ければ何も作れない。
 *
 * **理由を言って止める。** 言わないと、テンプレートを開こうとしたところで
 * ENOENT の生ログが出る。読んだ人には、何を打ち間違えたのかが分からない
 * （AUT-152）。題材アプリ2はここで詰まり、手で迂回している。
 */
function cannotGenerate(kitRoot) {
  if (existsSync(join(kitRoot, TEMPLATES_DIR))) return null;
  return refuse(
    "ここからは置けない。**プロジェクトの中のコピーには、テンプレートが入っていない。**\n\n" +
      "コピーが持っているのは実行するものだけで、ファイルを作る元は持っていない。\n" +
      "意図してそうしている（ADR 0004）。プロジェクトがファイルを生成することはない。\n\n" +
      "更新するときは、kit を外から取ってきて打つこと。\n\n" +
      `  ${FROM_SOURCE} update\n\n` +
      "**人が打つものではない。** 作業単位にして、ブランチの上で打つこと\n" +
      "（docs/autodrive.md「autodrive-dev-kit を更新する」）。",
  );
}

export function setup(mode , root , kitRoot , interviewer , inside = undefined) {
  const present = hasConfig(root);

  // 前提 ----------------------------------------------------------------------
  //
  // **打てる場所かを、いちばん先に見る。** 後ろに置くと、構成を聞き終えてから
  // 落ちる。答えさせてから「ここでは打てない」と言うことになる。
  const cannot = cannotGenerate(kitRoot);
  if (cannot !== null) return cannot;

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
        "  autodrive-dev-kit を新しいバージョンへ入れ替えるなら:  autodrive-dev-kit update\n" +
        `  構成を決め直すなら:              ${CONFIG_FILE} を消してから もう一度`,
    );
  }

  // 構成を決める --------------------------------------------------------------
  let config;
  let decisions;

  if (mode === "update") {
    const read = readConfig(root);
    if (read.error !== null) {
      // **壊れた構成を既定で埋めない。** 決めた内容が黙って別のものに入れ替わる。
      return refuse(`${read.error}\n\n直してから、もう一度実行すること。`);
    }
    config = read.config;
    decisions = PORT_NAMES.map(
      (p) => `${p}: ${config.ports[p]}${say(config.language, "decided.recorded")}`,
    );
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
  const result = init(root, kitRoot, config, inside);
  if (result.message !== null) return { ...result, notes: result.notes ?? [], config: null, decisions: [] };

  // **入れ替えでは触らない。** 決めた内容はプロジェクトのものである。読んだものを
  // 書き戻すだけでも、整形の違いや、このバージョンが知らない項目の欠落が入りうる。
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
