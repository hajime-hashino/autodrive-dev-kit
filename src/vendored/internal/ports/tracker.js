/**
 * Tracker ポートの語彙（定義§16）。
 *
 * **実装名を書かないこと。** 作業単位の状態はここで定義する語で表し、
 * 実装側の状態名との対応はアダプタが持つ。
 */

/** 作業単位の状態。実装側の呼び名ではなく、この語で扱う。 */
export const STATES = ["backlog", "todo", "started", "done", "canceled"];

/**
 * 本文を直せる状態。**着手前に限る**（定義§16）。
 *
 * **着手後の本文は「何を頼まれたか」の記録である。** 書き換えられる形にすると、
 * **「頼まれたとおり作ったか」を確かめられなくなる。** 作ったものに合わせて
 * 依頼を書き直せるためである。
 *
 * 着手後の訂正は「作業ログを追記する」で行う。
 */
export const REVISABLE_STATES = ["backlog", "todo"];

/** その状態で本文を直せるか。 */
export function isRevisable(state) {
  return REVISABLE_STATES.includes(state);
}

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
/**
 * Tracker ポートが持つ操作。
 *
 * **実装名を書かないこと。** ここに現れてよいのは操作と、その意味だけである。
 *
 * **`revise` は状態を見ない。** 書き換えるだけである。着手前に限る規則は
 * 呼び出し側（`trackerCli.js`）が持つ。**アダプタごとに同じ判断を置くと、
 * 実装が増えたときに片方だけ緩くなる。**
 *
 * @typedef {{
 *   get: (id: string) => Promise<WorkItemView>,
 *   list: (limit?: number) => Promise<WorkItemView[]>,
 *   create: (input: { title: string, body: string }) => Promise<WorkItemView>,
 *   revise: (id: string, body: string) => Promise<WorkItemView>,
 *   mark: (id: string, repo: string) => Promise<unknown>,
 *   advance: (id: string, to: WorkItemState, repo?: string) => Promise<WorkItemView>,
 *   note: (id: string, text: string) => Promise<unknown>,
 * }} TrackerPort
 */

export function isWorkItemState(value) {
  return (STATES).includes(value);
}
