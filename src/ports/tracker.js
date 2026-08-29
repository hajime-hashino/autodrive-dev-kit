/**
 * Tracker ポートの語彙（定義§16）。
 *
 * **実装名を書かないこと。** 作業単位の状態はここで定義する語で表し、
 * 実装側の状態名との対応はアダプタが持つ。
 */

/** 作業単位の状態。実装側の呼び名ではなく、この語で扱う。 */
export const STATES = ["backlog", "todo", "started", "done", "canceled"];

/** @typedef {"backlog" | "todo" | "started" | "done" | "canceled"} WorkItemState */

/** @typedef {{ id: string, title: string, state: WorkItemState, url: string, body: string }} WorkItemView */
export function isWorkItemState(value) {
  return (STATES).includes(value);
}
