/**
 * Telemetry ポートの JSONL アダプタ。
 *
 * 置き場所は `<対象リポジトリ>/telemetry/<作業単位ID>.jsonl`。作業単位ごとに
 * ファイルを分けるのは、並行作業時の追記衝突を避けるため。索引はディレクトリ
 * そのものとし、別途持たない。
 */

import { KIT_VERSION } from "../kitVersion.ts";
import { readSessionState } from "../sessionState.ts";
import { appendEvent, resolveWorkItem, telemetryPath } from "../workItem.ts";
import type {
  BoundaryRecord,
  FixRecord,
  SamplingRecord,
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
      // **種別と別に持つ。** 種別は「何について」、これは「減らす対象か」。
      // 種別から導けるようにすると、種別が増えるたびに対応表が要る。
      stop_type: record.stopType,
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

  recordSampling(record: SamplingRecord): void {
    this.#write({
      type: "sampling",
      area: record.area,
      looked: record.looked,
      not_looked: record.notLooked,
      // 修正の有無は真偽値で持つ。件数にすると修正率を算出できてしまい、
      // §8が禁じている使い方への道が開く。
      fixed: record.fixed,
      detail: record.detail,
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
  recordEnactment(invariant: string, detail: string, boundary: string): void {
    // 覆う範囲を印自身に持たせる。印の時刻とは別の値になりうるため
    //（記録の時刻が時計に基づいていない場合がある）、明示的に残す。
    this.#write({ type: "enactment", invariant, detail, boundary });
  }

  /**
   * 代替を記録する。
   *
   * **ポート語彙ではない。** 不変条件の発効状態についての記述であり、
   * 発効を判定する側（verify）が読む対象である。スキルからは呼ばれない。
   *
   * 定義§9は立ち上げ期の例外の条件として「代替した事実を記録に残すこと」を
   * 挙げている。手段が無ければ、条件を満たしようがない。
   */
  recordSubstitution(invariant: string, by: string, detail: string): void {
    this.#write({ type: "substitution", invariant, substituted_by: by, detail });
  }

  /** 必須属性の付与はここに閉じる。呼び出し側からは渡せない。 */
  #write(body: Record<string, unknown>): void {
    const { item, unattributedReason } = resolveWorkItem(this.#root);
    const session = readSessionState(this.#root);
    const path = telemetryPath(this.#root, item);

    appendEvent(path, {
      ts: this.#now().toISOString(),
      // 解決できない属性は握りつぶさず null で残す。理由を添えて残すことで、
      // 紐づく先が無いのか、仕掛けが壊れているのかを後から読める。
      work_item_id: item?.workItemId ?? null,
      model: session.last_model,
      kit_version: KIT_VERSION,
      emitter: "adapter",
      ...body,
      ...(item === null ? { unattributed_reason: unattributedReason } : {}),
    });
    this.#last = { path, attributed: item !== null };
  }
}
