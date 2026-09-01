/**
 * Tracker ポートの語彙（定義§16）。
 *
 * **実装名を書かないこと。** 作業単位の状態はここで定義する語で表し、
 * 実装側の状態名との対応はアダプタが持つ。
 */

/** 作業単位の状態。実装側の呼び名ではなく、この語で扱う。 */
export const STATES = ["backlog", "todo", "started", "done", "canceled"];

/** @typedef {"backlog" | "todo" | "started" | "done" | "canceled"} WorkItemState */

/**
 * 作業単位の見え方。
 *
 * `repo` は**この作業単位が変更を書き込むリポジトリ**である。着手のときに決まり、
 * 以降変わらない。1つの作業単位が書き込むリポジトリは1つに限るため、複数は持たない。
 *
 * **持たないと、一覧を見てもどれがどのリポジトリの作業か分からない。** 実際に、
 * 1つの対象へ4つのリポジトリの作業単位が混ざって読めなくなった（AUT-114）。
 * 決まっていなければ null。
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   state: WorkItemState,
 *   url: string,
 *   body: string,
 *   repo: string | null,
 * }} WorkItemView
 */
export function isWorkItemState(value) {
  return (STATES).includes(value);
}
