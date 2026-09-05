/**
 * 有効境界。
 *
 * 不変条件の判定を「いつ以降の記録に対して行うか」を定める境界。
 *
 * 立ち上げ期の直書きが記録に残り続ける以上、全期間を対象にすると有効へ到達できない。
 * 一方で「切り替えた日」を1回だけ置く形では、障害でアダプタが使えなくなり直書きへ
 * 戻ったあと、二度と復帰できない。したがって**動かせる境界**とする。
 *
 * 境界を進めるにはアダプタが動いている必要がある（境界イベント自体がアダプタ経由で
 * しか書けない）。壊れている間は動かせないため、直書きのまま有効を名乗れない。
 *
 * 進めた回数は隠さない。何度も動いていることは、ハーネスが安定していないという
 * 信号であり、外側ループが読むべき入力である。**何回で異常とみなすかは定めない。**
 * 定義§17が緩和しきい値を未確定としているのと同じ理由で、実データなしに数字を
 * 置くと根拠なく残る。
 */


export const ENACTMENT_TYPE = "enactment";

/** @typedef {{ since: string | null, moves: number }} Boundary */
/**
 * 時刻を解析する。読めない値は null を返す。
 *
 * **文字列のまま比べないこと。** ISO 表記はオフセットの書き方が複数あり、
 * 辞書順と実時刻の順序が一致しない。`2026-08-22T10:00:00+09:00`（=01:00Z）は
 * `2026-08-22T05:00:00Z` より辞書順では後、実時刻では先になる。
 */
export function parseTs(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function boundaryFor(events , invariantKey) {
  // 境界は自身が覆う範囲を boundary に持つ。持たない古い境界は、自身の時刻で代用する。
  const marks = events
    .filter((e) => e.type === ENACTMENT_TYPE && e.invariant === invariantKey)
    .map((e) => parseTs(e.boundary) ?? parseTs(e.ts))
    .filter((t) => t !== null)
    .sort((a, b) => a - b);
  const latest = marks.at(-1);
  return {
    since: latest === undefined ? null : new Date(latest).toISOString(),
    moves: marks.length,
  };
}

/**
 * 判定の対象になる記録を絞る。
 *
 * 境界より後の記録と、境界そのものを残す。境界より前の記録は消さない。
 * 判定の対象から外すだけであり、履歴としては残り続ける。
 *
 * 時刻が読めない記録は対象に残す。判定から外すほうへ倒すと、時刻を壊すことで
 * 記録を判定の外へ置ける経路ができる。
 */
export function eventsAfter(events , boundary) {
  const since = parseTs(boundary.since);
  if (since === null) return events;
  return events.filter((e) => {
    const ts = parseTs(e.ts);
    return ts === null || ts >= since;
  });
}
