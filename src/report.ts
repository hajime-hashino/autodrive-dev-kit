/** 判定結果の出力。 */

import { ACTIVE, NOT_IN_SCOPE, SUBSTITUTED, UNSUBSTITUTED } from "./state.ts";
import type { Result, Scope, State } from "./state.ts";
import type { Repo } from "./repos.ts";

const MARK: Record<State, string> = {
  [ACTIVE]: "発効",
  [SUBSTITUTED]: "未発効・代替あり",
  [UNSUBSTITUTED]: "未発効・代替なし",
  [NOT_IN_SCOPE]: "この範囲では判定しない",
};

export function renderText(results: Result[], repos: Repo[], scope: Scope): string {
  const lines: string[] = [
    "不変条件の発効判定",
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
      "未発効であること自体は失敗ではない。代替の記録が無いこと、" +
        "および判定できないことが失敗である。",
    );
  } else {
    lines.push("失敗なし");
  }
  return lines.join("\n");
}

export function renderJson(results: Result[], repos: Repo[], scope: Scope): string {
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
