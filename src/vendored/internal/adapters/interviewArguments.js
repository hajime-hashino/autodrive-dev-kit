/**
 * 引数で答える。
 *
 * **端末が無い呼び出し手のためにある。** `init` をエージェントに打たせると、
 * `/dev/tty` を開けないため答えを渡せなかった（AUT-271）。
 *
 * **答えは呼び出し手が人から聞いてくる。** ここは受け取るだけで、決めない。
 *
 * **渡されなかった問いは、次の聞き方へ回す。** 端末があれば聞き、無ければ推奨で
 * 進んだことが出る。引数があるかどうかで、渡されなかった問いの扱いを変えない。
 */

import { parseArgs } from "node:util";
import { LANGUAGES } from "../messages.js";
import { TRACKER_PREFIX } from "../config.js";
import { questionsFor } from "../setup.js";

/**
 * 引数で答えられる問いと、通る値。
 *
 * **選択肢は問いから取る。** 写しを持つと、選択肢が増えたときに片方だけ古くなる。
 *
 * @returns {Record<string, { values: string[] } | { pattern: RegExp, shape: string }>}
 */
function answerable() {
  const shapes = { language: { values: [...LANGUAGES] } };
  for (const q of questionsFor("en")) shapes[q.port] = { values: q.choices.map((c) => c.value) };
  shapes.prefix = { pattern: TRACKER_PREFIX, shape: "2-4 characters, starting with an uppercase letter" };
  return shapes;
}

/** 引数の名前。**問いの `name`、無ければポート名。** */
function nameOf(question) {
  return question.name ?? question.port;
}

/**
 * 引数を読む。**読めないものは飲み込まずに返す。**
 *
 * 選択肢に無い値を推奨に倒すと、指定したつもりの人が、指定が効かなかったことに
 * 気づけない（`chosen` と同じ理由）。**何も聞かず、何も置かないうちに止める。**
 *
 * @param {string[]} args
 * @returns {{ answers: Record<string, string>, error: string | null }}
 */
export function readAnswers(args) {
  const shapes = answerable();
  const options = Object.fromEntries(Object.keys(shapes).map((n) => [n, { type: /** @type {const} */ ("string") }]));

  let values;
  try {
    ({ values } = parseArgs({ args, options, strict: true, allowPositionals: false }));
  } catch (error) {
    return { answers: {}, error: `${/** @type {Error} */ (error).message}\n\n${usage(shapes)}` };
  }

  /** @type {Record<string, string>} */
  const answers = {};
  for (const [name, value] of Object.entries(values)) {
    const shape = shapes[name];
    const ok = "values" in shape ? shape.values.includes(value) : shape.pattern.test(value);
    if (!ok) {
      const expected = "values" in shape ? shape.values.join(" / ") : shape.shape;
      return { answers: {}, error: `--${name} ${value} is not accepted. **Nothing was placed.**\n\n  Expected: ${expected}` };
    }
    answers[name] = value;
  }
  return { answers, error: null };
}

/** 渡せる引数の一覧。**読めない引数で止めたときに出す。** */
function usage(shapes) {
  const lines = ["Answers that can be given as arguments:", ""];
  for (const [name, shape] of Object.entries(shapes)) {
    lines.push(`  --${name.padEnd(9)} ${"values" in shape ? shape.values.join(" / ") : shape.shape}`);
  }
  return lines.join("\n");
}

/**
 * 引数で答え、渡されなかった問いは `fallback` に回す。
 *
 * **使われなかった答えを数える。** 接頭辞は Tracker が GitHub Issues のときにしか
 * 聞かない。渡したのに使われなかったことを出さないと、効いたように見える。
 *
 * @param {Record<string, string>} answers
 * @param {import("../ports/interview.js").InterviewPort} fallback
 */
export function argumentInterview(answers, fallback) {
  const used = new Set();
  const take = (question) => {
    const name = nameOf(question);
    if (name === undefined || !(name in answers)) return undefined;
    used.add(name);
    return answers[name];
  };

  return {
    answer(question) {
      return take(question) ?? fallback.answer(question);
    },

    value(question) {
      return take(question) ?? (fallback.value === undefined ? null : fallback.value(question));
    },

    /** 渡されたのに聞かれなかったもの。 */
    unused() {
      return Object.keys(answers).filter((n) => !used.has(n));
    },
  };
}
