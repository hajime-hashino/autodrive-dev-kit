/**
 * 境界表（定義§8）の読取と、版と版の差分。
 *
 * **セルが動いたかどうかだけを見る。** コメントや根拠の書き足しは動きではない。
 * 見るのは領域の増減と、`detectable` / `reversible` / `state` の変化に限る。
 *
 * YAML の一般の構文は扱わない。境界表の構造だけを読む。汎用の解析器を持ち込むと
 * 依存が増え、判定器がその挙動に引きずられる。
 */

/** @typedef {{ id: string, detectable: boolean, reversible: boolean, state: string }} Area */
const FIELDS = ["detectable", "reversible", "state"];

/**
 * 境界表の本文から領域を読む。
 *
 * `- id:` で領域が始まり、同じ深さの `detectable:` などが属性になる。
 * `basis: |` のような塊は、より深い字下げが続く間まとめて読み飛ばす。
 * **読み飛ばさないと、根拠の本文に現れた `state:` を属性と誤読する。**
 */
export function parseAreas(text) {
  const areas = [];
  const lines = text.split("\n");

  let current = null;
  let blockIndent = null;

  const flush = () => {
    if (current?.id === undefined) return;
    areas.push({
      id: current.id,
      detectable: current.detectable ?? false,
      reversible: current.reversible ?? false,
      state: current.state ?? "",
    });
  };

  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;

    // 塊の中身は、始まった行より深い字下げが続く間ずっと中身。
    if (blockIndent !== null) {
      if (indent > blockIndent) continue;
      blockIndent = null;
    }

    const start = /^\s*-\s+id:\s*(.+?)\s*$/.exec(line);
    if (start) {
      flush();
      current = { id: strip(start[1]) };
      continue;
    }
    if (current === null) continue;

    const field = /^\s*([A-Za-z_]+):\s*(.*?)\s*$/.exec(line);
    if (!field) continue;
    const [, key, rawValue] = field;

    if (rawValue === "|" || rawValue === ">" || rawValue === "|-" || rawValue === ">-") {
      blockIndent = indent;
      continue;
    }
    if (!(FIELDS).includes(key)) continue;

    const value = strip(rawValue);
    if (key === "state") current.state = value;
    else if (key === "detectable") current.detectable = value === "true";
    else current.reversible = value === "true";
  }
  flush();
  return areas;
}

function strip(value) {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  return withoutComment.replace(/^["']|["']$/g, "");
}

/** セルまたは状態が動いた領域の id。増減も動きとして数える。 */
export function movedAreas(before , after) {
  const byId = (list) => new Map(list.map((a) => [a.id, a]));
  const b = byId(before);
  const a = byId(after);
  const moved = [];

  for (const [id, area] of a) {
    const prev = b.get(id);
    if (prev === undefined) {
      moved.push(id);
      continue;
    }
    if (
      prev.detectable !== area.detectable ||
      prev.reversible !== area.reversible ||
      prev.state !== area.state
    ) {
      moved.push(id);
    }
  }
  for (const id of b.keys()) if (!a.has(id)) moved.push(id);

  return moved;
}
