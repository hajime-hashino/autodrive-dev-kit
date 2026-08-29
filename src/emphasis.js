/**
 * 強調が実際に強調として表示されるかを見る。
 *
 * **日本語では `**強調**` が黙って効かなくなる。** CommonMark は閉じの区切りに
 * flanking 規則を課しており、`**強調**は` のように**助詞が直後に続くと閉じられない。**
 * 書いた側には見えず、読む側には平文として届く。
 *
 * 実際に出た。README で1箇所が指摘され、調べたところ文書全体で20箇所を超えていた。
 * **人が目で見つけるものではない。**
 *
 * 見るのは開閉が揃うかまでで、**強調すべきかどうかは見ない。**
 */

/** Unicode 空白か。 */
function isSpace(c) {
  return /\s/u.test(c);
}

/** CommonMark のいう約物か（P* と S*）。 */
function isPunct(c) {
  return /[\p{P}\p{S}]/u.test(c);
}

/** @typedef {{ line: number, text: string }} Broken */
/**
 * 閉じられていない `**` を探す。
 *
 * **段落単位で見る。** 強調は行をまたげるため、行単位で見ると折り返しを誤検出する。
 */
export function brokenEmphasis(body) {
  const found = [];
  const lines = body.split("\n");

  let start = 0;
  let buffer = [];
  let inFence = false;

  const flush = () => {
    if (buffer.length > 0) {
      // **囲みの中は対象外。** 記号としての `*` が入る。長さを保つと、位置がずれない。
      const joined = buffer.join("\n").replace(/`[^`]*`/g, (m) => " ".repeat(m.length));
      for (const at of unclosed(joined)) {
        // **開いたままの箇所そのものを指す。** 段落の先頭を出すと、箇条書きが
        // 続く場所で、どの項目が壊れているのか分からない。
        const offset = joined.slice(0, at).split("\n").length - 1;
        found.push({ line: start + offset + 1, text: buffer[offset].trim() });
      }
    }
    buffer = [];
  };

  lines.forEach((line, i) => {
    if (line.trimStart().startsWith("```")) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (line.trim() === "") {
      flush();
      return;
    }
    if (buffer.length === 0) start = i;
    buffer.push(line);
  });
  flush();

  return found;
}

/** 開いたまま閉じられない `**` の位置。 */
function unclosed(text) {
  const open = [];

  for (const m of text.matchAll(/\*+/g)) {
    if (m[0].length < 2) continue;
    const at = m.index;
    const before = at > 0 ? text[at - 1] : " ";
    const after = at + m[0].length < text.length ? text[at + m[0].length] : " ";

    const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
    const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));

    const canClose = right && (!left || isPunct(after));
    const canOpen = left && (!right || isPunct(before));

    if (open.length > 0 && canClose) {
      open.pop();
      continue;
    }
    if (canOpen) open.push(at);
  }

  return open;
}
