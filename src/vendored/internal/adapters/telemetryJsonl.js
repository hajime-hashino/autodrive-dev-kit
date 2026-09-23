/**
 * Telemetry ポートの JSONL アダプタ。
 *
 * 置き場所は `<対象リポジトリ>/telemetry/<作業単位ID>.jsonl`。作業単位ごとに
 * ファイルを分けるのは、並行作業時の追記衝突を避けるため。索引はディレクトリ
 * そのものとし、別途持たない。
 */

import { KIT_VERSION } from "../kitVersion.js";
import { readSessionState } from "../sessionState.js";
import { appendEvent, resolveWorkItem, telemetryPath } from "../workItem.js";


export class JsonlTelemetry {
           #root;
           #now;
  // **`null` で初期化した変数に型を書かないと `null` 型と推論される。** 値を
  // 入れた瞬間に落ち、呼び出し側では `never` になる（AUT-226）。
  /** @type {WriteResult | null} */
  #last = null;
/** @typedef {{ path: string, attributed: boolean }} WriteResult */
  constructor(root , now = () => new Date()) {
    this.#root = root;
    this.#now = now;
  }

  /** 直前の書き込み先。呼び出し側へ結果を見せるために持つ。 */
  get lastWrite() {
    return this.#last;
  }

  recordStop(record) {
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

  recordFix(record) {
    this.#write({
      // 検出漏れは独立した操作を持たず、発見された工程を属性で表す（定義§16）。
      type: record.foundIn === undefined ? "rework" : "miss",
      target: record.target,
      detail: record.detail,
      ...(record.cause === undefined ? {} : { cause: record.cause }),
      ...(record.foundIn === undefined ? {} : { found_in: record.foundIn }),
    });
  }

  recordSampling(record) {
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

  recordBoundaryChange(record) {
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
   * 有効境界を進める。
   *
   * **ポート語彙ではない。** スキルからは呼ばれない。判定の起点を動かす操作であり、
   * 有効を判定する側（invariants）が使う。ここに置いているのは、必須属性の付与を
   * 1箇所に閉じるためと、この経路を通れること自体がアダプタが動いている証明に
   * なるためである。壊れていれば有効境界を進められない。
   */
  recordEnactment(invariant , detail , boundary) {
    // 覆う範囲を有効境界自身に持たせる。有効境界の時刻とは別の値になりうるため
    //（記録の時刻が時計に基づいていない場合がある）、明示的に残す。
    this.#write({ type: "enactment", invariant, detail, boundary });
  }

  /**
   * 代替を記録する。
   *
   * **ポート語彙ではない。** 不変条件の有効状態についての記述であり、
   * 有効を判定する側（invariants）が読む対象である。スキルからは呼ばれない。
   *
   * 定義§9は立ち上げ期の例外の条件として「代替した事実を記録に残すこと」を
   * 挙げている。手段が無ければ、条件を満たしようがない。
   */
  recordSubstitution(invariant , by , detail) {
    this.#write({ type: "substitution", invariant, substituted_by: by, detail });
  }

  /** 必須属性の付与はここに閉じる。呼び出し側からは渡せない。 */
  #write(body) {
    const { item, unattributedReason } = resolveWorkItem(this.#root);
    const session = readSessionState(this.#root);
    const path = telemetryPath(this.#root, item);

    appendEvent(path, {
      ts: this.#now().toISOString(),
      // 解決できない属性は捨てずに null で残す。理由を添えて残すことで、
      // 紐づく先が無いのか、仕掛けが壊れているのかを後から読める。
      work_item_id: item?.workItemId ?? null,
      model: session.last_model,
      // **分からなかったことを、そう書く。** null だけ残すと、壊れた記録と
      // 見分けがつかない。**欠けているのは事実であって、偽りではない。**
      //
      // **理由を断定しない。** 以前は「まだ無い。最初のターンで書かれた」と
      // 書いていたが、**確かめていたのは1箇所の不在だけだった。** 実際には別の
      // 場所にあり、6件が誤った理由を持ったまま残った（AUT-231）。
      // **誤った理由は、理由が無いより悪い。** 読んだ人が別の場所を探さなくなる。
      ...(session.last_model === null
        ? {
            model_unavailable_reason:
              "セッションの記録が見つからない（起点から上へ辿って探した）。" +
              "セッション最初のターンでは、まだ書かれていない（AUT-107）",
          }
        : {}),
      kit_version: KIT_VERSION,
      emitter: "adapter",
      ...body,
      ...(item === null ? { unattributed_reason: unattributedReason } : {}),
    });
    this.#last = { path, attributed: item !== null };
  }
}
