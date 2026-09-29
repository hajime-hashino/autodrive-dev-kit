/** 判定結果の出力。 */

import { say } from "./messages.js";
import { ACTIVE, NOT_IN_SCOPE, SUBSTITUTED, UNSUBSTITUTED } from "./state.js";


/**
 * 状態の名前（定義§9 v0.12）。
 *
 * **どれも「いま何であるか」を言う。** 状態の不在を名前にすると、実際に何が
 * 起きているのかが読めない。「未有効」ではなく「代替」としているのはそのため。
 */
/** 状態と、文の項目名の対応。**綴りは `messages.js` が持つ。** */
const STATE_KEY = {
  [ACTIVE]: "state.active",
  [SUBSTITUTED]: "state.substituted",
  [UNSUBSTITUTED]: "state.unsubstituted",
  [NOT_IN_SCOPE]: "state.notInScope",
};

/** 状態の記号。**判定と文書で同じものを見るために出す。** */
export const MARK = Object.fromEntries(
  Object.entries(STATE_KEY).map(([state, key]) => [state, say("ja", key)]),
);

/** 不変条件の名前。**言語ごとに `messages.js` が持つ。** */
export const labelOf = (key, language) => say(language, `invariant.${key}`);

/**
 * @param {import("./messages.js").Language} language
 */
export function renderText(results , repos , scope , language = "ja") {
  const t = (key, values) => say(language, key, values);
  const lines = [
    t("report.title"),
    t("report.repos", { repos: repos.map((r) => r.name).join(", ") }),
    t("report.scope", { scope }),
  ];
  // **観測の中身は英語である**（AUT-264）。言語が ja なら、黙って混ぜず、そう断る（AUT-135）。
  const hasDetail = results.some(
    (r) => r.observations.length + r.substitutions.length + r.unimplemented.length > 0,
  );
  if (language === "ja" && hasDetail) lines.push(t("report.evidence.en"));
  lines.push("");

  for (const r of results) {
    lines.push(`[${t(STATE_KEY[r.state])}] ${labelOf(r.key, language)}`);
    for (const o of r.observations) lines.push(`    ${t("report.observed")}  ${o}`);
    for (const s of r.substitutions) lines.push(`    ${t("report.substituted")}  ${s}`);
    for (const u of r.unimplemented) lines.push(`    ${t("report.unimplemented")} ${u}`);
    lines.push("");
  }
  const failed = results.filter((r) => r.failing);
  if (failed.length > 0) {
    lines.push(t("report.failed", { labels: failed.map((r) => labelOf(r.key, language)).join(language === "ja" ? "、" : ", ") }));
    lines.push(t("report.failed.why"));
  } else {
    lines.push(t("report.ok"));
  }
  return lines.join("\n");
}

export function renderJson(results , repos , scope , language = "ja", forbidden = [], isolation = []) {
  return JSON.stringify(
    {
      scope,
      repos: repos.map((r) => r.name),
      invariants: results.map((r) => ({
        key: r.key,
        label: labelOf(r.key, language),
        state: r.state,
        observations: r.observations,
        substitutions: r.substitutions,
        unimplemented: r.unimplemented,
      })),
      failing: results.filter((r) => r.failing).map((r) => r.key),
      // **中身は載せない。** どのファイルが何に当たるかだけ。
      forbidden: forbidden.map((f) => ({ path: f.path, why: f.why })),
      isolation: isolation.map((g) => ({ path: g.path, gap: g.gap })),
    },
    null,
    2,
  );
}
