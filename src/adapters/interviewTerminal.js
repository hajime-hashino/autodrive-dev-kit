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
import { say } from "../messages.js";

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
 * 問いを出す。
 *
 * **言語は問いが持つ。** 出す側が決めると、言語を選ぶ前の問い（言語そのものを
 * 聞くもの）を出せない。
 */
export function render(question) {
  // **言語は問いが持つ。** 出す側が決めると、言語を選ぶ前の問い（言語そのものを
  // 聞くもの）を出せない。
  const language = question.language ?? "ja";
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
  return {
    answer(question) {
      // **開けないなら、質問を出さない。** 出すなら必ず待つ。
      const fd = open();
      if (fd === null) return null;

      try {
        for (;;) {
          write(render(question));
          const { value, retry } = chosen(question, read(fd));
          if (!retry) return value;
          write(say(question.language ?? "ja", "ask.notAChoice"));
        }
      } finally {
        try {
          close(fd);
        } catch {
          // 閉じられなくても、聞けたことは変わらない。
        }
      }
    },
  };
}
