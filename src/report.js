/** 判定結果の出力。 */

import { ACTIVE, NOT_IN_SCOPE, SUBSTITUTED, UNSUBSTITUTED } from "./state.js";


/**
 * 状態の名前（定義§9 v0.12）。
 *
 * **どれも「いま何であるか」を言う。** 状態の不在を名前にすると、実際に何が
 * 起きているのかが読めない。「未有効」ではなく「代替」としているのはそのため。
 */
const MARK = {
  [ACTIVE]: "有効",
  [SUBSTITUTED]: "代替",
  [UNSUBSTITUTED]: "要対応",
  [NOT_IN_SCOPE]: "対象外",
};

export function renderText(results , repos , scope) {
  const lines = [
    "不変条件の状態",
    `判定対象: ${repos.map((r) => r.name).join(", ")}`,
    `実行範囲: ${scope}`,
    "",
  ];
  for (const r of results) {
    lines.push(`[${MARK[r.state]}] ${r.label}`);
    for (const o of r.observations) lines.push(`    観測  ${o}`);
    for (const s of r.substitutions) lines.push(`    代替  ${s}`);
    for (const u of r.unimplemented) lines.push(`    未実装 ${u}`);
    lines.push("");
  }
  const failed = results.filter((r) => r.failing);
  if (failed.length > 0) {
    lines.push(`失敗: ${failed.map((r) => r.label).join("、")}`);
    lines.push(
      "代替であること自体は失敗ではない。肩代わりの記録が無いこと、" +
        "および有効かどうかを判定できないことが失敗である。",
    );
  } else {
    lines.push("失敗なし");
  }
  return lines.join("\n");
}

export function renderJson(results , repos , scope) {
  return JSON.stringify(
    {
      scope,
      repos: repos.map((r) => r.name),
      invariants: results.map((r) => ({
        key: r.key,
        label: r.label,
        state: r.state,
        observations: r.observations,
        substitutions: r.substitutions,
        unimplemented: r.unimplemented,
      })),
      failing: results.filter((r) => r.failing).map((r) => r.key),
    },
    null,
    2,
  );
}
