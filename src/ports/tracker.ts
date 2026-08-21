/**
 * Tracker ポートの語彙（定義§16）。
 *
 * **実装名を書かないこと。** 作業単位の状態はここで定義する語で表し、
 * 実装側の状態名との対応はアダプタが持つ。
 */

/** 作業単位の状態。実装側の呼び名ではなく、この語で扱う。 */
export const STATES = ["backlog", "todo", "started", "done", "canceled"] as const;
export type WorkItemState = (typeof STATES)[number];

export interface WorkItemView {
  id: string;
  title: string;
  state: WorkItemState;
  url: string;
  body: string;
}

export interface CreateInput {
  title: string;
  body: string;
}

export interface TrackerPort {
  /** 作業単位を取得する。ID を省いた場合は次に着手する対象。 */
  get(id?: string): Promise<WorkItemView | null>;
  /** 作業単位を起票する。 */
  create(input: CreateInput): Promise<WorkItemView>;
  /** 状態を進める。 */
  advance(id: string, to: WorkItemState): Promise<WorkItemView>;
  /** 経過を追記する。 */
  note(id: string, text: string): Promise<void>;
}

export function isWorkItemState(value: string): value is WorkItemState {
  return (STATES as readonly string[]).includes(value);
}
