/**
 * 品質の証跡。
 *
 * ## 指標ではない
 *
 * 定義§1は目的（成果物の品質が、進める人の熟練に依存しない状態）を**指標として
 * 直接測定しない**としている。「一定の品質」を人ごと・プロダクトごとに定義できず、
 * **測れない基準を指標に置くと、達成したことにできてしまう**ためである。
 *
 * **したがって、ここは点を付けない。** 出すのは「何を、どの手法で、どこまで確かめたか」
 * と「**誰も見ていないのはどこか**」である。自己申告の点数より、導出された事実のほうが
 * 第三者の問いに耐える。
 *
 * ## 空欄を作らない
 *
 * **無いものは「無い」と書く**（定義§9「判定できない状態を通過として扱わない」）。
 * 空欄は読む人に「問題なし」と読まれる。
 *
 * ## 数だけを出さない
 *
 * 検出漏れ0件は、**起きなかったのか、記録していないのか、作っていないのか**が
 * 区別できない。**分母を添える。**
 */

import { loadEvents } from "./telemetry.js";

/** 証跡が読む記録の種類。 */
const MISS = "miss";
const REWORK = "rework";
const SAMPLING = "sampling";
const BOUNDARY = "boundary_change";
const STOP = "stop";

/** 決めた結果の置き場。`init` が播種する。 */
export const QUALITY_FILE = "docs/quality.md";

/**
 * テンプレートのまま残っている行。
 *
 * **埋まっていないことを、埋まっていると読ませない。** 例として置いた行が残って
 * いれば、そこは決めていない。`docs/what-why.md` の `(write here)` と同じ見方である。
 *
 * **日本語の目印も読み続ける**（AUT-263）。雛形を英語にしても、既に配った先の
 * `docs/quality.md` はプロジェクトのものであり、`update` でも日本語のまま残る。
 *
 * 英語の例の目印を `(e.g.` にしないのは、**普通の文でも使われるためである。**
 * 利用者が自分で書いた行を、決めていない行として読むことになる。
 */
export function unfilled(body) {
  if (body === null) return [];
  return body
    .split("\n")
    .map((line, i) => ({ line: line.trim(), at: i + 1 }))
    .filter(({ line }) => UNFILLED.some((marker) => line.includes(marker)));
}

/** 雛形に置いた目印。英語の雛形のものと、それより前の日本語の雛形のもの。 */
const UNFILLED = ["(example:", "(write here)", "（例：", "（ここに書く）"];

/** 値ごとの件数。**多い順**。読む人が最初に見るべきものを上に出す。 */
function tally(rows, pick) {
  const counts = new Map();
  for (const r of rows) {
    const key = String(pick(r) ?? "(not recorded)").trim() || "(not recorded)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
}

/**
 * 記録から証跡を組み立てる。**読むだけで、判定しない。**
 *
 * **記録の形を `object` と書かないこと。** 属性を読めない型になり、`e.type` すら
 * 引けなくなる（型検査を入れて判明。AUT-226）。
 *
 * @param {{ events: import("./telemetry.js").TelemetryEvent[], quality: Array<{ repo: string, body: string | null }> }} input
 */
export function summarize({ events, quality }) {
  const of = (type) => events.filter((e) => e.type === type);
  const misses = of(MISS);
  const samplings = of(SAMPLING);

  return {
    // **分母。** これが無いと、件数の少なさが良い知らせに見える。
    scale: {
      events: events.length,
      workItems: new Set(events.map((e) => e.work_item_id).filter(Boolean)).size,
      repos: quality.map((q) => q.repo),
      // **リポジトリごとに何を読んだかを出す。** 名前だけ並べても、読み手は
      // どこからの話かを追えない。
      perRepo: quality.map((q) => ({
        repo: q.repo,
        events: events.filter((e) => String(e.source ?? "").startsWith(`${q.repo}/`)).length,
        decided: q.body !== null && unfilled(q.body).length === 0,
      })),
    },
    // 決めたことの置き場。**無ければ、その事実を出す。**
    decided: quality.map((q) => ({
      repo: q.repo,
      placed: q.body !== null,
      unfilled: unfilled(q.body),
    })),
    // 実際に漏れた誤り。**どこで見つかったかまで出す。** 本番で見つかるほど遠い。
    escaped: {
      total: misses.length,
      byStage: tally(misses, (m) => m.found_in),
      byCause: tally(misses, (m) => m.cause),
    },
    rework: { total: of(REWORK).length, byCause: tally(of(REWORK), (r) => r.cause) },
    // 人が見た範囲。**見なかった範囲を必ず添える**（定義§8）。
    sampled: samplings.map((s) => ({
      area: s.area ?? "(not recorded)",
      looked: s.looked ?? "(not recorded)",
      notLooked: s.not_looked ?? "(not recorded)",
      fixed: s.fixed === true,
    })),
    boundaryChanges: of(BOUNDARY).map((b) => ({
      area: b.area,
      from: b.from,
      to: b.to,
      basis: b.basis ?? "(not recorded)",
    })),
    stops: { total: of(STOP).length, byType: tally(of(STOP), (s) => s.stop_type) },
  };
}

/**
 * 読みどころ。**観察と、次にすることまで出す。**
 *
 * **並べるだけにしない。** 数を出して「あとは読んだ人が判断してください」で終えると、
 * 分析を人へ押し付けたことになる。**判断のコストを下げるのが役割であり、判断を消す
 * ことではない**（配布物「意思決定は代行しない」）。
 *
 * **ただし良し悪しは言わない**（定義§1）。言うのは「何が起きているか」と
 * 「次に何をするか」であって、「良い／悪い」ではない。決めるのは人である。
 *
 * **割合で言わない。** `N 件のうち M 件` の形で出す。分母が消えると、数の大小が
 * そのまま評価に読まれる。
 */
export function findings(data) {
  const out = [];
  const add = (observation, why, next) => out.push({ observation, why, next });

  const undecided = data.decided.filter((d) => !d.placed || d.unfilled.length > 0);
  if (undecided.length > 0) {
    add(
      `In ${undecided.length} repositories, what to check has not been decided (${QUALITY_FILE}).`,
      "**The top of this report stays empty.** Readers cannot tell whether nothing was checked or it was just not written down.",
      `Fill in ${QUALITY_FILE} in each repository. The aspects vary with the nature of the repository.`,
    );
  }

  // **記録の値は、日本語と英語のどちらもありうる。** 見つかった工程は自由記述であり、
  // 配布物を英語にしてから production と書かれるようになる（AUT-264）。
  const prod = data.escaped.byStage.find((s) => s.name === "本番" || s.name.toLowerCase() === "production");
  if (prod !== undefined && data.escaped.total > 0) {
    add(
      `Of ${data.escaped.total} missed detections, ${prod.n} were found in production.`,
      "**Being found in production means nothing before it caught them.** Users noticed first.",
      "Look at the breakdown of causes for those found in production, and decide which stage to add detection to.",
    );
  }

  // **自由記述の集計は、種類が増えると読めなくなる。**
  if (data.escaped.byStage.length >= 10) {
    add(
      `The stages where they were found are scattered across ${data.escaped.byStage.length} kinds.`,
      "**When the same stage is written in different words, the counts split and the trend cannot be seen.** It does not hold up to aggregation.",
      "Either use fixed words, or group them on the report side. Which to do is the human's decision.",
    );
  }

  for (const [label, rows] of [
    ["cause of missed detection", data.escaped.byCause],
    ["kind of stop", data.stops.byType],
  ]) {
    const missing = rows.find((r) => r.name === "(not recorded)");
    if (missing !== undefined) {
      add(
        `${missing.n} records have no ${label}.`,
        "**Those are in no breakdown.** The sum of the breakdown does not match the total.",
        "It is attached at the time of recording. Classifying later brings in the interpretation of whoever classified.",
      );
    }
  }

  if (data.sampled.length === 0 && data.scale.events > 0) {
    add(
      "There is not a single spot check record.",
      "**Nobody is looking at the undetectable areas** (definition §8). Errors that do not fail automatically remain unless a human looks.",
      "Decide the undetectable areas, and record the range looked at and the range not looked at.",
    );
  }

  if (data.boundaryChanges.length === 0 && data.scale.events > 0) {
    add(
      "There is not a single record of moving what is delegated.",
      "**There is no evidence the outer loop has run.** The side that reads records and fixes the machinery may not be working.",
      "Read the records and see whether there are areas where the scope of delegation can be moved.",
    );
  }

  const topRework = data.rework.byCause[0];
  if (topRework !== undefined && data.rework.total > 0) {
    add(
      `Of ${data.rework.total} rework records, the most common cause is "${topRework.name}" with ${topRework.n}.`,
      "**A skew in causes points at which stage has low accuracy** (definition §6).",
      "See whether detection can be added to that stage. If not, leave it as a range humans look at.",
    );
  }

  return out;
}

/** 「無い」の言い方。**なぜ空なのかまで言う。** 空欄は「問題なし」と読まれる。 */
function none(hasAnyRecord, what) {
  return hasAnyRecord
    ? `Not a single record. **Whether no ${what} happened in this period or it was not recorded cannot be told from this alone.**`
    : `There are no records at all. **Nothing is recorded, let alone ${what}.**`;
}

function listed(rows, limit = 12) {
  const head = rows.slice(0, limit).map((r) => `    ${r.name}: ${r.n}`);
  return rows.length > limit ? [...head, `    … ${rows.length - limit} more kinds`] : head;
}

/**
 * 人が読む形にする。
 *
 * **点を付けない。** 読んだ人が「良い／悪い」を自分で判断できる材料だけを並べる。
 */
export function render(data) {
  const any = data.scale.events > 0;
  const out = ["Quality evidence", ""];

  out.push(
    "**This is not a quality score.** It is \"what was checked, and how far\" and \"where nobody is looking,\"",
    "derived from the records. **No score is given.**",
    "",
    "## Scope",
    "",
    "**Which aspects to check differs per repository.** Different nature, different things to look at.",
    `Each repository's ${QUALITY_FILE} holds that. **This report reads what is written there.**`,
    "",
    "| Repository | Records | Decided what to check? |",
    "|---|---|---|",
    ...data.scale.perRepo.map(
      (r) => `| ${r.repo} | ${r.events} | ${r.decided ? "Decided" : "**Not decided**"} |`,
    ),
    "",
    `  Total: ${data.scale.events} records / ${data.scale.workItems} work items`,
    "",
  );

  // **並べるだけにしない。** 分析を人へ押し付けたことになる。
  const notes = findings(data);
  out.push("## What to read");
  if (notes.length === 0) {
    out.push("  **Nothing can be said from the records.** The records themselves may be insufficient.");
  } else {
    for (const [i, n] of notes.entries()) {
      out.push(`  ${i + 1}. ${n.observation}`, `     ${n.why}`, `     **Next:** ${n.next}`, "");
    }
  }
  out.push(
    "**What is written here are observations derivable from the records.** Which to fix, and which not to, is the human's decision.",
    "",
  );

  out.push("## What was decided to check");
  for (const d of data.decided) {
    if (!d.placed) {
      out.push(`  ${d.repo}: **no ${QUALITY_FILE}. What to check has not been decided.**`);
      continue;
    }
    if (d.unfilled.length === 0) {
      out.push(`  ${d.repo}: in ${QUALITY_FILE} (no unfilled fields)`);
      continue;
    }
    out.push(`  ${d.repo}: **${d.unfilled.length} unfilled rows.**`);
    for (const u of d.unfilled.slice(0, 6)) out.push(`      ${QUALITY_FILE}:${u.at}  ${u.line}`);
    if (d.unfilled.length > 6) out.push(`      … ${d.unfilled.length - 6} more rows`);
  }
  out.push("");

  out.push("## Errors that actually slipped through");
  if (data.escaped.total === 0) {
    out.push(`  ${none(any, "missed detections")}`);
  } else {
    out.push(`  ${data.escaped.total}. **The later the stage where they were found, the farther away detection is.**`);
    out.push("  Stage where found:", ...listed(data.escaped.byStage));
    out.push("  Cause:", ...listed(data.escaped.byCause));
  }
  out.push("");

  out.push("## Rework");
  if (data.rework.total === 0) out.push(`  ${none(any, "rework")}`);
  else out.push(`  ${data.rework.total}`, "  Cause:", ...listed(data.rework.byCause));
  out.push("");

  out.push("## What humans looked at");
  if (data.sampled.length === 0) {
    out.push(`  ${none(any, "spot checks")}`);
  } else {
    for (const s of data.sampled) {
      out.push(
        `  ${s.area}${s.fixed ? " (corrected)" : " (no correction)"}`,
        `      Looked at: ${s.looked}`,
        `      **Not looked at: ${s.notLooked}**`,
      );
    }
  }
  out.push("");

  out.push("## Grounds for moving what is delegated");
  if (data.boundaryChanges.length === 0) out.push(`  ${none(any, "delegation changes")}`);
  else {
    for (const b of data.boundaryChanges) {
      out.push(`  ${b.area}: ${b.from} → ${b.to}`, `      Ground: ${b.basis}`);
    }
  }
  out.push("");

  out.push("## How often humans were stopped");
  if (data.stops.total === 0) out.push(`  ${none(any, "stops")}`);
  else out.push(`  ${data.stops.total}`, ...listed(data.stops.byType));
  out.push("");

  // **言えないことを言う。** 出せる範囲を超えて読まれると、この証跡自体が誤りになる。
  out.push(
    "## What this evidence does not say",
    "  - **It does not show that the product's quality is good.** It only shows what was checked",
    "  - **It does not show that the means of checking are correct.** A passing test passes even if it looks at nothing",
    `  - **Checks not written in ${QUALITY_FILE} do not appear here.** What is merely not written`,
    "    cannot be told apart from what is not done",
  );
  return out.join("\n");
}

/** 記録を読み、証跡にする。 */
export function evidence(repos) {
  const { events, broken } = loadEvents(repos);
  const quality = repos.map((r) => ({
    repo: r.name,
    body: (() => {
      try {
        return r.read(`${r.path}/${QUALITY_FILE}`);
      } catch {
        return null;
      }
    })(),
  }));
  return { data: summarize({ events, quality }), broken };
}
