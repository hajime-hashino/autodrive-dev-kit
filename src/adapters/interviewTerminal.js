/**
 * 端末で聞く。
 *
 * **依存を足さない**（ADR 0001）。標準入力を同期で読む。`init` は一度きりの
 * 短いやり取りであり、非同期にする理由が無い。
 *
 * **端末でなければ聞かない。** パイプの先や CI で止まると、何も出ないまま
 * 待ち続ける。その場合は答えられないことを返し、呼び出し側が推奨で進める。
 */

import { readSync } from "node:fs";


/** 標準入力から1行。**同期で読む。** 終端なら null。 */
export function readStdinLine() {
  const chunks = [];
  const buf = Buffer.alloc(1);

  while (true) {
    let n;
    try {
      n = readSync(0, buf, 0, 1, null);
    } catch {
      return null;
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

export function render(question) {
  const lines = [``, question.ask, `  ${question.why}`, ``];
  question.choices.forEach((c, i) => {
    lines.push(`  ${i + 1}. ${c.label}${c.value === question.recommended ? "  ← 推奨" : ""}`);
  });
  lines.push(``, `番号を入れる（そのまま Enter で推奨）: `);
  return lines.join("\n");
}

export function terminalInterview(
  read = readStdinLine,
  write = (s) => process.stdout.write(s),
  isTerminal = () => process.stdin.isTTY === true,
) {
  return {
    answer(question) {
      if (!isTerminal()) return null;

      for (;;) {
        write(render(question));
        const { value, retry } = chosen(question, read());
        if (!retry) return value;
        write(`\n  それは選択肢に無い。もう一度。\n`);
      }
    },
  };
}
