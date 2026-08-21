/**
 * 発効境界。
 *
 * 不変条件の判定を「いつ以降の記録に対して行うか」を定める印。
 *
 * 立ち上げ期の直書きが記録に残り続ける以上、全期間を対象にすると発効へ到達できない。
 * 一方で「切り替えた日」を1回だけ置く形では、障害でアダプタが使えなくなり直書きへ
 * 戻ったあと、二度と復帰できない。したがって**動かせる印**とする。
 *
 * 印を進めるにはアダプタが動いている必要がある（境界イベント自体がアダプタ経由で
 * しか書けない）。壊れている間は動かせないため、直書きのまま発効を名乗れない。
 *
 * 進めた回数は隠さない。何度も動いていることは、ハーネスが安定していないという
 * 信号であり、外側ループが読むべき入力である。**何回で異常とみなすかは定めない。**
 * 定義§17が緩和しきい値を未確定としているのと同じ理由で、実データなしに数字を
 * 置くと根拠なく残る。
 */

import type { TelemetryEvent } from "./telemetry.ts";

export const ENACTMENT_TYPE = "enactment";

export interface Boundary {
  /** この時刻より後の記録だけを判定の対象にする。印が無ければ null。 */
  since: string | null;
  /** 印を進めた回数。 */
  moves: number;
}

export function boundaryFor(events: TelemetryEvent[], invariantKey: string): Boundary {
  const marks = events
    .filter((e) => e.type === ENACTMENT_TYPE && e.invariant === invariantKey)
    .map((e) => (typeof e.ts === "string" ? e.ts : ""))
    .filter((ts) => ts !== "")
    .sort();
  return { since: marks.at(-1) ?? null, moves: marks.length };
}

/**
 * 判定の対象になる記録を絞る。
 *
 * 境界そのものと、境界より後の記録を残す。境界より前の記録は消さない。
 * 判定の対象から外すだけであり、履歴としては残り続ける。
 */
export function eventsAfter(events: TelemetryEvent[], boundary: Boundary): TelemetryEvent[] {
  if (boundary.since === null) return events;
  return events.filter((e) => typeof e.ts === "string" && e.ts >= (boundary.since as string));
}
