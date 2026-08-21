/**
 * Telemetry ポートの JSONL アダプタ。
 *
 * 置き場所は `<対象リポジトリ>/telemetry/<作業単位ID>.jsonl`。作業単位ごとに
 * ファイルを分けるのは、並行作業時の追記衝突を避けるため。索引はディレクトリ
 * そのものとし、別途持たない。
 */

import { KIT_VERSION } from "../kitVersion.ts";
import { readSessionState } from "../sessionState.ts";
import { appendEvent, currentWorkItem, telemetryPath } from "../workItem.ts";
import type {
  BoundaryRecord,
  FixRecord,
  StopRecord,
  TelemetryPort,
} from "../ports/telemetry.ts";

export interface WriteResult {
  path: string;
  attributed: boolean;
}

export class JsonlTelemetry implements TelemetryPort {
  readonly #root: string;
  readonly #now: () => Date;
  #last: WriteResult | null = null;

  constructor(root: string, now: () => Date = () => new Date()) {
    this.#root = root;
    this.#now = now;
  }

  /** 直前の書き込み先。呼び出し側へ結果を見せるために持つ。 */
  get lastWrite(): WriteResult | null {
    return this.#last;
  }

  recordStop(record: StopRecord): void {
    this.#write({
      type: "stop",
      stop_kind: record.kind,
      detail: record.detail,
      resolved: record.resolved ?? false,
    });
  }

  recordFix(record: FixRecord): void {
    this.#write({
      // 検出漏れは独立した操作を持たず、発見された工程を属性で表す（定義§16）。
      type: record.foundIn === undefined ? "rework" : "miss",
      target: record.target,
      detail: record.detail,
      ...(record.cause === undefined ? {} : { cause: record.cause }),
      ...(record.foundIn === undefined ? {} : { found_in: record.foundIn }),
    });
  }

  recordBoundaryChange(record: BoundaryRecord): void {
    this.#write({
      type: "boundary_change",
      area: record.area,
      from: record.from,
      to: record.to,
      detail: record.detail,
      ...(record.basis === undefined ? {} : { basis: record.basis }),
    });
  }

  /**
   * 発効境界を進める。
   *
   * **ポート語彙ではない。** スキルからは呼ばれない。判定の起点を動かす操作であり、
   * 発効を判定する側（verify）が使う。ここに置いているのは、必須属性の付与を
   * 1箇所に閉じるためと、この経路を通れること自体がアダプタが動いている証明に
   * なるためである。壊れていれば印を進められない。
   */
  recordEnactment(invariant: string, detail: string): void {
    this.#write({ type: "enactment", invariant, detail });
  }

  /** 必須属性の付与はここに閉じる。呼び出し側からは渡せない。 */
  #write(body: Record<string, unknown>): void {
    const item = currentWorkItem(this.#root);
    const session = readSessionState(this.#root);
    const path = telemetryPath(this.#root, item);

    appendEvent(path, {
      ts: this.#now().toISOString(),
      // 解決できない属性は握りつぶさず null で残す。作業単位に紐づかない作業は
      // 起票せずに始めた作業であり、記録から消すと違反も消える。
      work_item_id: item?.workItemId ?? null,
      model: session.last_model,
      kit_version: KIT_VERSION,
      emitter: "adapter",
      ...body,
      ...(item === null
        ? { unattributed_reason: "作業単位マーカーが無い。起票せずに作業した可能性がある" }
        : {}),
    });
    this.#last = { path, attributed: item !== null };
  }
}
