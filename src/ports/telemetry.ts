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

/**
 * 停止の種類（定義§6）。
 *
 * **すべての停止が減らす対象ではない。** 一括りにすると、必要な対話まで削られる。
 * 実際にその誤読が起きた（AUT-77）。
 */
export const STOP_TYPES = ["入力", "手戻り"] as const;
export type StopType = (typeof STOP_TYPES)[number];

/**
 * 人に判断を仰いだ事実と種別を残す。
 *
 * **記録の時点で種類を区別する**（定義§6）。後から分類し直すと、分類した側の
 * 解釈が入る。手戻りの原因の内訳を記録時に付けるのと同じ理由。
 *
 *   入力    何を作るかのヒアリング、見え方の決定、順序の合意、資格情報の発行
 *   手戻り  認識が違っていた、作り直しが要る、承認で差し戻された
 *
 * **同じことを繰り返し聞くのは、入力ではなく手戻りである**（定義§6）。
 */
export interface StopRecord {
  /** 何について止まったか。**繰り返し出る種別はスキル化の候補になる**（定義§6）。 */
  kind: string;
  /** 減らす対象かどうか。 */
  stopType: StopType;
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

/**
 * 見た範囲・見なかった範囲と、修正の有無を残す。
 *
 * **修正が入らなかった場合も必ず記録する。** 定義§8は緩和の判定を「N回連続で
 * 修正が入らないこと」で行うとしており、修正が無かった回が残らなければ判定が
 * 成立しない。
 *
 * 見なかった範囲を必須にするのも同じ理由による。見ていないのか、見て問題が
 * 無かったのかを区別できない記録は、判断を誤らせる（§8）。
 */
export interface SamplingRecord {
  area: string;
  /** 見た範囲。 */
  looked: string;
  /** 見なかった範囲。省略できない。 */
  notLooked: string;
  /** 修正が入ったか。入らなかった場合も記録する。 */
  fixed: boolean;
  detail: string;
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
  /** 抜き取り確認を記録する */
  recordSampling(record: SamplingRecord): void;
  /** 境界変更を記録する */
  recordBoundaryChange(record: BoundaryRecord): void;
}
