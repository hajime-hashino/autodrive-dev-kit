/**
 * ヒアリングのポート。
 *
 * **端末から切り離す。** 端末に直に書くと、テストが端末を要求する。判定できない
 * ものは、いずれ判定されなくなる。
 *
 * 選択肢を出して選ばせる形に限っている。**自由記述を受け取らない。** 自由記述は、
 * 受け取った側が意味を解釈することになり、何が選ばれたのかが記録から読めなくなる。
 */

export interface Question {
  /** 何を決めるのか。**専門語で聞かない。** */
  ask: string;
  /** なぜ聞くのか。判断の材料である（作業ルール「停止するときの作法」）。 */
  why: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
  /** 推奨する選択肢の値。**推奨は示すが、決めない。** */
  recommended: string;
}

/**
 * 問いに答える。
 *
 * **答えられない場合は null を返す。** 呼び出し側は推奨で進めたうえで、そう
 * したことを出す。黙って既定に倒れると、決めていないものが決めたものに見える。
 */
export interface InterviewPort {
  answer(question: Question): string | null;
}

/** 誰にも聞けないとき。**推奨で進める。** 端末が無い場合（CI、テスト）に使う。 */
export const useRecommended: InterviewPort = {
  answer: () => null,
};
