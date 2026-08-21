/**
 * Telemetry ポートの語彙（定義§16）。
 *
 * **実装名を書かないこと。** ここに現れてよいのは操作と、その意味だけである。
 * どこへどう書くかを知るのはアダプタに限る。
 *
 * 必須属性（work_item_id / model / kit_version / emitter）は呼び出し側から
 * 受け取らない。アダプタが自動で付与する。渡せる形にすると、渡し忘れた記録と
 * 渡された記録が混ざり、遡って直せなくなる。
 */

/** 人に判断を仰いだ事実と種別を残す。 */
export interface StopRecord {
  kind: string;
  detail: string;
  resolved?: boolean;
}

/**
 * 人が手を入れた事実と対象を残す。
 *
 * 検出漏れは独立した操作を設けず、発見された工程を `foundIn` に持たせる
 * （定義§16の補足）。原因の内訳は定義§6が求めるため `cause` に持つ。
 */
export interface FixRecord {
  target: string;
  detail: string;
  /** 要件のズレ／設計のズレ／実装バグ（定義§6） */
  cause?: string;
  /** 後工程や本番で見つかった場合、その工程。検出漏れの記録になる。 */
  foundIn?: string;
}

/** 委譲範囲の変更と、その後の結果を残す。 */
export interface BoundaryRecord {
  area: string;
  from: string;
  to: string;
  detail: string;
  /** 緩めた根拠（観察中の件数、修正の有無などの実績） */
  basis?: string;
}

export interface TelemetryPort {
  /** 停止を記録する */
  recordStop(record: StopRecord): void;
  /** 修正を記録する */
  recordFix(record: FixRecord): void;
  /** 境界変更を記録する */
  recordBoundaryChange(record: BoundaryRecord): void;
}
