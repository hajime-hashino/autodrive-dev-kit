/**
 * 端末で聞く。
 *
 * **依存を足さない**（ADR 0001）。同期で読む。`init` は一度きりの短いやり取りで
 * あり、非同期にする理由が無い。
 *
 * **聞けないなら、質問を出さない。** 出しておいて待たないと、画面には聞いている
 * ように見えて答えを受け取っていない状態になる。実際にそうなった（AUT-101）。
 *
 * **端末でなければ聞かない。** パイプの先や CI で止まると、何も出ないまま待ち
 * 続ける。その場合は答えられないことを返し、呼び出し側が推奨で進める。
 */

import { closeSync, openSync, readSync } from "node:fs";
import { say, DEFAULT_LANGUAGE } from "../messages.js";

/**
 * 端末を、待てる形で開く。
 *
 * **標準入力（fd 0）をそのまま読まない。** 非ブロッキングで開かれていることが
 * あり、macOS では `EAGAIN` が返る。**まだ入力が無いという意味であって、終端では
 * ない。** `/dev/tty` を開き直すと待てる。
 *
 * @returns {number | null} 読める fd。開けなければ null
 */
export function openTerminal() {
  try {
    return openSync("/dev/tty", "rs");
  } catch {
    return null;
  }
}

/** 少しだけ待つ。**依存を足さずに同期で眠る。** */
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 読めなかった理由を見分ける。
 *
 * **すべての失敗を終端として扱わない。** `EAGAIN` は「まだ入力が無い」であって、
 * 「もう来ない」ではない。**待てばよいものを諦めると、聞いたつもりで聞けていない。**
 *
 * @param {unknown} error
 * @returns {"また試す" | "終わり"}
 */
export function howToHandle(error) {
  const code = /** @type {{ code?: string }} */ (error)?.code;
  return code === "EAGAIN" || code === "EWOULDBLOCK" ? "また試す" : "終わり";
}


/**
 * 端末から1行。**同期で読む。** 終端なら null。
 *
 * **入力が来るまで待つ。** `EAGAIN` で諦めない。
 *
 * @param {number} fd
 * @returns {string | null}
 */
export function readLineFrom(fd) {
  const chunks = [];
  const buf = Buffer.alloc(1);

  for (;;) {
    let n;
    try {
      n = readSync(fd, buf, 0, 1, null);
    } catch (error) {
      if (howToHandle(error) === "終わり") {
        return chunks.length === 0 ? null : Buffer.concat(chunks).toString("utf8");
      }
      // まだ入力が無いだけ。**待つ。**
      pause(20);
      continue;
    }
    if (n === 0) return chunks.length === 0 ? null : Buffer.concat(chunks).toString("utf8");
    if (buf[0] === 0x0a) return Buffer.concat(chunks).toString("utf8");
    chunks.push(Buffer.from(buf));
  }
}

/**
 * 選ばれた値を返す。**選択肢に無いものは飲み込まない。**
 *
 * 出力と入力から切り離してある。ここが判定の対象であり、端末は要らない。
 */
export function chosen(question , line) {
  if (line === null) return { value: null, retry: false };

  const trimmed = line.trim();
  // そのまま Enter は「推奨でよい」。**無言の同意ではなく、明示された選択である。**
  if (trimmed === "") return { value: question.recommended, retry: false };

  const n = Number(trimmed);
  // **読めない答えを推奨として飲み込まない。** 選んだつもりの人が、
  // 選ばれなかったことに気づけない。
  if (!Number.isInteger(n) || n < 1 || n > question.choices.length) {
    return { value: null, retry: true };
  }
  return { value: question.choices[n - 1].value, retry: false };
}

/**
 * 書かれた値を受け取る。**形に合わないものは飲み込まない。**
 *
 * `chosen` と同じく、出力と入力から切り離してある。**ここが判定の対象である。**
 *
 * - そのまま Enter は「案でよい」。**案が無ければ、書くまで聞き直す**
 * - 形に合わなければ聞き直す。**読めない答えを案として飲み込まない**
 * - 終端なら諦める（端末が閉じた）
 *
 * @param {import("../ports/interview.js").ValueQuestion} question
 * @param {string | null} line
 * @returns {{ value: string | null, retry: boolean }}
 */
export function accepted(question, line) {
  if (line === null) return { value: null, retry: false };

  const trimmed = line.trim();
  if (trimmed === "") {
    // 案が無いのに Enter を押されたら、空で進めずに聞き直す。
    return question.suggested === null
      ? { value: null, retry: true }
      : { value: question.suggested, retry: false };
  }
  if (!question.pattern.test(trimmed)) return { value: null, retry: true };
  return { value: trimmed, retry: false };
}

/**
 * 書かせる問いを出す。
 *
 * **形を先に見せる。** 見せずに聞き直すと、何が悪かったのかが分からない。
 */
export function renderValue(question) {
  const language = question.language ?? DEFAULT_LANGUAGE;
  const lines = [``, question.ask, `  ${question.why}`, ``, `  ${question.shape}`];
  if (question.suggested !== null) {
    lines.push(`  ${say(language, "ask.suggested", { value: question.suggested })}`);
  }
  lines.push(``, say(language, "ask.prompt.value"));
  return lines.join("\n");
}

/**
 * 問いを出す。
 *
 * **言語は問いが持つ。** 出す側が決めると、言語を選ぶ前の問い（言語そのものを
 * 聞くもの）を出せない。
 */
export function render(question) {
  // **言語は問いが持つ。** 出す側が決めると、言語を選ぶ前の問い（言語そのものを
  // 聞くもの）を出せない。
  const language = question.language ?? DEFAULT_LANGUAGE;
  const lines = [``, question.ask, `  ${question.why}`, ``];
  question.choices.forEach((c, i) => {
    const mark = c.value === question.recommended ? say(language, "ask.recommended") : "";
    lines.push(`  ${i + 1}. ${c.label}${mark}`);
  });
  lines.push(``, say(language, "ask.prompt"));
  return lines.join("\n");
}

/**
 * 端末で聞く。
 *
 * **聞けるかを先に確かめる。** 質問を出してから読めないと分かっても、もう出て
 * しまっている。画面には聞いているように見えて、答えを受け取っていない状態になる。
 *
 * @param {() => number | null} open 端末を開く。開けなければ null
 * @param {(fd: number) => string | null} read 1行読む
 * @param {(s: string) => void} write
 * @param {(fd: number) => void} close
 */
export function terminalInterview(
  open = openTerminal,
  read = readLineFrom,
  write = (s) => process.stdout.write(s),
  close = closeSync,
) {
  /**
   * 聞いて、答えが通るまで繰り返す。**2つの聞き方で共通である。**
   *
   * **開けないなら、質問を出さない。** 出すなら必ず待つ。
   */
  const askUntilAccepted = (show, take, complain) => {
    const fd = open();
    if (fd === null) return null;

    try {
      for (;;) {
        write(show());
        const { value, retry } = take(read(fd));
        if (!retry) return value;
        write(complain());
      }
    } finally {
      try {
        close(fd);
      } catch {
        // 閉じられなくても、聞けたことは変わらない。
      }
    }
  };

  return {
    answer(question) {
      const language = question.language ?? DEFAULT_LANGUAGE;
      return askUntilAccepted(
        () => render(question),
        (line) => chosen(question, line),
        () => say(language, "ask.notAChoice"),
      );
    },

    value(question) {
      const language = question.language ?? DEFAULT_LANGUAGE;
      return askUntilAccepted(
        () => renderValue(question),
        (line) => accepted(question, line),
        () => say(language, "ask.notInShape", { shape: question.shape }),
      );
    },
  };
}
