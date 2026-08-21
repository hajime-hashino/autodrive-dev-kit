/**
 * 判定の状態と、1つの不変条件についての判定結果。
 *
 * 状態だけを返すことはしない。判定根拠が読めない出力は意味を持たないため、
 * 何を見て何が見つかった／見つからなかったかを必ず添える。
 */

export const ACTIVE = "ACTIVE" as const; // 発効している
export const SUBSTITUTED = "SUBSTITUTED" as const; // 未発効。代替の事実が記録にある
export const UNSUBSTITUTED = "UNSUBSTITUTED" as const; // 未発効。代替の記録が無い、または判定不能
export const NOT_IN_SCOPE = "NOT_IN_SCOPE" as const; // この実行範囲では判定しない

export type State =
  | typeof ACTIVE
  | typeof SUBSTITUTED
  | typeof UNSUBSTITUTED
  | typeof NOT_IN_SCOPE;

/**
 * UNSUBSTITUTED だけが失敗である。
 *
 * 未発効であること自体は失敗ではない（定義§9の立ち上げ期の例外）。
 * 失敗なのは、代替の記録が無いことと、判定ができないことである。
 */
export const FAILING: ReadonlySet<State> = new Set<State>([UNSUBSTITUTED]);

export type Scope = "cross" | "self";

export class Result {
  readonly key: string;
  readonly label: string;
  readonly observations: string[] = [];
  readonly substitutions: string[] = [];
  readonly unimplemented: string[] = [];
  #state: State | null = null;

  constructor(key: string, label: string) {
    this.key = key;
    this.label = label;
  }

  observe(text: string): void {
    this.observations.push(text);
  }

  substitutedBy(text: string): void {
    this.substitutions.push(text);
  }

  /** まだ実装していない判定。1つでもあれば ACTIVE には到達させない。 */
  notImplemented(text: string): void {
    this.unimplemented.push(text);
  }

  conclude(state: State): Result {
    let next = state;
    // 判定していない項目が残っている状態を、発効と呼んではいけない。
    if (next === ACTIVE && this.unimplemented.length > 0) next = SUBSTITUTED;
    // 未発効なのに代替の記録が無いなら、立ち上げ期の例外の条件を満たさない。
    if (next === SUBSTITUTED && this.substitutions.length === 0) next = UNSUBSTITUTED;
    this.#state = next;
    return this;
  }

  /** 判定を経ずに状態を決める。実行範囲の対象外を示す場合にのみ使う。 */
  skip(reason: string): Result {
    this.observe(reason);
    this.#state = NOT_IN_SCOPE;
    return this;
  }

  get state(): State {
    if (this.#state === null) throw new Error(`${this.key}: 判定が終わっていない`);
    return this.#state;
  }

  get failing(): boolean {
    return FAILING.has(this.state);
  }
}

export const INVARIANTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "outer_loop_running", label: "外側ループが起動し、継続すること" },
  { key: "telemetry_recorded", label: "テレメトリが記録されること" },
  { key: "boundary_change_logged", label: "境界変更が履歴に残ること" },
  { key: "ai_cannot_disable", label: "AIがこれらを無効化できないこと" },
];
