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
import { basename, join, resolve } from "node:path";
import { TEMPLATES_DIR, VENDOR_DIR, init } from "./init.js";
import { manifestPath, readPlacedPorts } from "./manifest.js";
import { credentialsFor } from "./credentials.js";
import { LANGUAGES, say, DEFAULT_LANGUAGE } from "./messages.js";

import {
  CONFIG_FILE,
  NONE,
  PORT_NAMES,
  defaults,
  hasConfig,
  infer,
  readConfig,
  suggestPrefix,
  TRACKER_PREFIX,
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
      port: "tracker",
      language,
      ask: t("ask.tracker"),
      why: t("ask.tracker.why"),
      choices: [
        { value: "linear", label: t("ask.tracker.linear") },
        { value: "github-issues", label: t("ask.tracker.github") },
      ],
      recommended: "linear",
    },
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
  recommended: DEFAULT_LANGUAGE,
};

/** 既定の言語で聞くこと。**古い呼び出しのために残す。** */
export const QUESTIONS = questionsFor(DEFAULT_LANGUAGE);


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

/**
 * 作業単位IDの接頭辞を聞く。
 *
 * **案はリポジトリ名から作る。** 決定ではない。そのまま Enter で案を採れる。
 *
 * **聞けなければ案で進み、そう書く。** 端末が無い場合（CI、テスト）である。
 * 黙って案に倒れると、決めていないものが決めたものに見える。
 *
 * @param {import("./ports/interview.js").InterviewPort} interviewer
 * @param {"ja" | "en"} language
 * @param {string} repoName
 * @returns {{ prefix: string | null, how: string }}
 */
export function askPrefix(interviewer, language, repoName) {
  const suggested = suggestPrefix(repoName);
  const answered =
    interviewer.value === undefined
      ? null
      : interviewer.value({
          ask: say(language, "ask.tracker.prefix"),
          why: say(language, "ask.tracker.prefix.why"),
          shape: say(language, "ask.tracker.prefix.shape"),
          pattern: TRACKER_PREFIX,
          suggested,
          language,
        });

  if (answered !== null) return { prefix: answered, how: say(language, "decided.chosen") };
  if (suggested !== null) return { prefix: suggested, how: say(language, "decided.recommended") };
  // **埋められないなら、埋めない。** 空で進むと、形の違う値が構成に入る。
  return { prefix: null, how: say(language, "decided.undecided") };
}

/**
 * 接頭辞が要るのに無ければ、何を決めればよいかを返す。
 *
 * **案は出すが、書かない。** 接頭辞はブランチ名と記録のファイル名になる。
 * 決めるのは人である（`askPrefix` と同じ）。
 *
 * @param {import("./config.js").Config} config
 * @param {string} root
 * @returns {string | null}
 */
export function missingPrefix(config, root) {
  if (config.ports.tracker !== "github-issues" || config.tracker.prefix !== null) return null;
  const suggested = suggestPrefix(basename(resolve(root)));
  return (
    `tracker in ${CONFIG_FILE} is github-issues, but there is no tracker.prefix. **Stopped without placing anything.**\n\n` +
    "Decide the 2–4 characters starting with an uppercase letter that lead each work item ID (e.g. AIEP → AIEP-123).\n" +
    "It becomes the branch name and the record file name. **Changing it later breaks the trail of earlier records.**\n\n" +
    (suggested === null ? "" : `Suggestion: ${suggested} (made from the repository name. Not a decision)\n\n`) +
    `Once decided, write it in ${CONFIG_FILE} and run again.\n\n` +
    `  "tracker": { "prefix": "${suggested ?? "AIEP"}" }`
  );
}

/**
 * ポートが変わったことで、人が知っておくべきこと。
 *
 * **失うものと、やり直すものを、変えた時点で言う。** 言わなければ、気づくのは
 * 困ったときになる（AUT-248）。
 *
 * **前の記録が無ければ、確かめていないと言う。** 黙ると、変わっていないように見える。
 *
 * @param {import("./config.js").Config} config
 * @param {Record<string, string> | null} before
 * @returns {{ notes: string[], todo: string[] }}
 */
export function portChanges(config, before) {
  const t = (key, values) => say(config.language, key, values);
  if (before === null) return { notes: [t("note.portsUnchecked")], todo: [] };

  const notes = [];
  const todo = [];
  const was = before.tracker;
  if (was !== undefined && was !== config.ports.tracker) {
    notes.push(t("note.trackerChanged", { from: was, to: config.ports.tracker }));
  }

  // **発行はAIにはできない。** 増えた資格情報だけを頼む。全部並べると、既に
  // 持っているものまで取りに行かせる。
  const previous = { ...config, ports: { ...config.ports, ...before } };
  const had = new Set(credentialsFor(previous).map((c) => c.name));
  const added = credentialsFor(config)
    .filter((c) => !had.has(c.name))
    .map((c) => c.name);
  if (added.length > 0) todo.push(t("todo.newCredentials", { names: added.join(", ") }));

  return { notes, todo };
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
export const FROM_SOURCE = "npx github:hajime-hashino/autodrive-dev-kit";

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
    "Cannot place files from here. **The copy inside the project does not include the templates.**\n\n" +
      "The copy holds only what runs, not the sources files are made from.\n" +
      "This is intentional (ADR 0004). The project never generates files.\n\n" +
      "To update, fetch the kit from outside and run it.\n\n" +
      `  ${FROM_SOURCE} update\n\n` +
      "**This is not something a human runs.** Make it a work item and run it on a branch\n" +
      "(\"Updating autodrive-dev-kit\" in docs/autodrive-reference.md).",
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
      `There is no ${CONFIG_FILE}. **This project does not have the foundation placed yet.**\n\n` +
        "  To start new:                     autodrive-dev-kit init\n" +
        "  To add it to an existing project: autodrive-dev-kit apply",
    );
  }
  if (mode !== "update" && present) {
    return refuse(
      `${CONFIG_FILE} already exists. **Overwriting it erases what was decided.**\n\n` +
        "  To move autodrive-dev-kit to a newer version:  autodrive-dev-kit update\n" +
        `  To decide the configuration again:             delete ${CONFIG_FILE}, then run again`,
    );
  }

  // 構成を決める --------------------------------------------------------------
  let config;
  let decisions;
  // **前に置いたときのポート。** 入れ替えで上書きされる前に読む。
  const placedPorts = mode === "update" ? readPlacedPorts(manifestPath(root, VENDOR_DIR)) : null;

  if (mode === "update") {
    const read = readConfig(root);
    if (read.error !== null) {
      // **壊れた構成を既定で埋めない。** 決めた内容が黙って別のものに入れ替わる。
      return refuse(`${read.error}\n\nFix it, then run again.`);
    }
    config = read.config;

    // **決まっていない値を残したまま置かない。** 入れ替えは聞かない（AIが端末無しで
    // 打つ）。ポートを変えて接頭辞が要るようになっても、ここでは聞けない。
    // 置いてしまうと、着手のときに初めて止まる（AUT-248）。
    const missing = missingPrefix(config, root);
    if (missing !== null) return refuse(missing);

    decisions = PORT_NAMES.map((p) => {
      const before = placedPorts?.[p];
      const how =
        before !== undefined && before !== config.ports[p]
          ? say(config.language, "decided.changed", { from: before })
          : say(config.language, "decided.recorded");
      return `${p}: ${config.ports[p]}${how}`;
    });
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

  // **番号しか持たない実装には、接頭辞を用意する。**
  //
  // **聞く。** 選択肢に並べられないが、形は決まっている。形が決まっているものは
  // 書かせてよい（`ports/interview.js`）。**案を書いておいて人が直す形にしない。**
  // ブランチ名と記録のファイル名になるため、後から変えると既に書いた記録が迷子になる。
  if (mode !== "update" && config.ports.tracker === "github-issues" && config.tracker.prefix === null) {
    const { prefix, how } = askPrefix(interviewer, config.language, basename(resolve(root)));
    config.tracker.prefix = prefix;
    decisions.push(`tracker.prefix: ${prefix ?? "**not decided**"}${how}`);
  }

  // 置く ----------------------------------------------------------------------
  const result = init(root, kitRoot, config, inside);
  if (result.message !== null) return { ...result, notes: result.notes ?? [], config: null, decisions: [] };

  // **入れ替えでは触らない。** 決めた内容はプロジェクトのものである。読んだものを
  // 書き戻すだけでも、整形の違いや、このバージョンが知らない項目の欠落が入りうる。
  if (mode === "update") {
    result.placed.push({ path: CONFIG_FILE, placement: "skipped" });
    // 入れ替えは、既に動いているプロジェクトに対して打つ。始め方の案内は要らない。
    // **文言そのもので外す。** 日本語の「はじめる」で探していたため、言語が en の
    // プロジェクトでは、入れ替えのたびに始め方の案内が出ていた（AUT-264）。
    const start = say(config.language, "todo.start");
    result.todo = result.todo.filter((t) => t !== start);
    const changed = portChanges(config, placedPorts);
    result.notes = [...(result.notes ?? []), ...changed.notes];
    result.todo = [...changed.todo, ...result.todo];
  } else {
    writeConfig(root, config);
    result.placed.push({ path: CONFIG_FILE, placement: "seeded" });
  }

  return { ...result, config, decisions };
}
