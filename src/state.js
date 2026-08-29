/**
 * 判定の状態と、1つの不変条件についての判定結果。
 *
 * 状態だけを返すことはしない。判定根拠が読めない出力は意味を持たないため、
 * 何を見て何が見つかった／見つからなかったかを必ず添える。
 */

export const ACTIVE = "ACTIVE"; // 有効。仕組みとして働いている
export const SUBSTITUTED = "SUBSTITUTED"; // 代替。人が肩代わりし、その事実が記録にある
export const UNSUBSTITUTED = "UNSUBSTITUTED"; // 要対応。肩代わりの記録が無い、または判定不能
export const NOT_IN_SCOPE = "NOT_IN_SCOPE"; // 対象外。この実行範囲では扱わない


/**
 * UNSUBSTITUTED だけが失敗である。
 *
 * 代替であること自体は失敗ではない（定義§9の立ち上げ期の例外）。
 * 失敗なのは、肩代わりの記録が無いことと、有効かどうかを判定できないことである。
 */
export const FAILING = new Set ([UNSUBSTITUTED]);


export class Result {
           key;
           label;
           observations = [];
           substitutions = [];
           unimplemented = [];
  #state = null;
/** @typedef {"cross" | "self"} Scope */
  constructor(key , label) {
    this.key = key;
    this.label = label;
  }

  observe(text) {
    this.observations.push(text);
  }

  substitutedBy(text) {
    this.substitutions.push(text);
  }

  /** まだ実装していない判定。1つでもあれば ACTIVE には到達させない。 */
  notImplemented(text) {
    this.unimplemented.push(text);
  }

  conclude(state) {
    // 判定しないと決めた結果は、代替の有無を問わない。
    if (state === NOT_IN_SCOPE) {
      this.#state = NOT_IN_SCOPE;
      return this;
    }
    let next = state;
    // 判定していない項目が残っている状態を、有効と呼んではいけない。
    if (next === ACTIVE && this.unimplemented.length > 0) next = SUBSTITUTED;
    // 代替と判定したのに肩代わりの記録が無いなら、立ち上げ期の例外の条件を満たさない。
    if (next === SUBSTITUTED && this.substitutions.length === 0) next = UNSUBSTITUTED;
    this.#state = next;
    return this;
  }

  /** 判定を経ずに状態を決める。実行範囲の対象外を示す場合にのみ使う。 */
  skip(reason) {
    this.observe(reason);
    this.#state = NOT_IN_SCOPE;
    return this;
  }

  get state() {
    if (this.#state === null) throw new Error(`${this.key}: 判定が終わっていない`);
    return this.#state;
  }

  get failing() {
    return FAILING.has(this.state);
  }
}

export const INVARIANTS = [
  { key: "outer_loop_running", label: "外側ループが起動し、継続すること" },
  { key: "telemetry_recorded", label: "テレメトリが記録されること" },
  { key: "boundary_change_logged", label: "境界変更が履歴に残ること" },
  { key: "ai_cannot_disable", label: "AIがこれらを無効化できないこと" },
];
