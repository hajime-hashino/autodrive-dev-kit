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
 * いれば、そこは決めていない。`docs/what-why.md` の `（ここに書く）` と同じ見方である。
 */
export function unfilled(body) {
  if (body === null) return [];
  return body
    .split("\n")
    .map((line, i) => ({ line: line.trim(), at: i + 1 }))
    .filter(({ line }) => line.includes("（例：") || line.includes("（ここに書く）"));
}

/** 値ごとの件数。**多い順**。読む人が最初に見るべきものを上に出す。 */
function tally(rows, pick) {
  const counts = new Map();
  for (const r of rows) {
    const key = String(pick(r) ?? "（記録に無い）").trim() || "（記録に無い）";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
}

/**
 * 記録から証跡を組み立てる。**読むだけで、判定しない。**
 *
 * @param {{ events: object[], quality: Array<{ repo: string, body: string | null }> }} input
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
      area: s.area ?? "（記録に無い）",
      looked: s.looked ?? "（記録に無い）",
      notLooked: s.not_looked ?? "（記録に無い）",
      fixed: s.fixed === true,
    })),
    boundaryChanges: of(BOUNDARY).map((b) => ({
      area: b.area,
      from: b.from,
      to: b.to,
      basis: b.basis ?? "（記録に無い）",
    })),
    stops: { total: of(STOP).length, byType: tally(of(STOP), (s) => s.stop_type) },
  };
}

/** 「無い」の言い方。**なぜ空なのかまで言う。** 空欄は「問題なし」と読まれる。 */
function none(hasAnyRecord, what) {
  return hasAnyRecord
    ? `記録が1件も無い。**この期間に${what}が起きなかったのか、記録していないのかは、これだけでは区別できない。**`
    : `記録そのものが1件も無い。**${what}以前に、何も記録されていない。**`;
}

function listed(rows, limit = 12) {
  const head = rows.slice(0, limit).map((r) => `    ${r.name}: ${r.n} 件`);
  return rows.length > limit ? [...head, `    … 他 ${rows.length - limit} 種`] : head;
}

/**
 * 人が読む形にする。
 *
 * **点を付けない。** 読んだ人が「良い／悪い」を自分で判断できる材料だけを並べる。
 */
export function render(data) {
  const any = data.scale.events > 0;
  const out = ["品質の証跡", ""];

  out.push(
    "**これは品質の点数ではない。**「何を、どこまで確かめたか」と「誰も見ていないのはどこか」",
    "を、記録から出したものである。良いか悪いかは、読んだ人が判断する。",
    "",
    "## 対象",
    `  リポジトリ: ${data.scale.repos.join(", ") || "（無い）"}`,
    `  記録: ${data.scale.events} 件 / 作業単位 ${data.scale.workItems} 件`,
    "",
  );

  out.push("## 何を確かめると決めたか");
  for (const d of data.decided) {
    if (!d.placed) {
      out.push(`  ${d.repo}: **${QUALITY_FILE} が無い。何を確かめるかが決まっていない。**`);
      continue;
    }
    if (d.unfilled.length === 0) {
      out.push(`  ${d.repo}: ${QUALITY_FILE} にある（未記入の欄は無い）`);
      continue;
    }
    out.push(`  ${d.repo}: **未記入の欄が ${d.unfilled.length} 行ある。**`);
    for (const u of d.unfilled.slice(0, 6)) out.push(`      ${QUALITY_FILE}:${u.at}  ${u.line}`);
    if (d.unfilled.length > 6) out.push(`      … 他 ${d.unfilled.length - 6} 行`);
  }
  out.push("");

  out.push("## 実際に漏れた誤り");
  if (data.escaped.total === 0) {
    out.push(`  ${none(any, "検出漏れ")}`);
  } else {
    out.push(`  ${data.escaped.total} 件。**見つかった工程が後ろであるほど、検出が遠い。**`);
    out.push("  見つかった工程:", ...listed(data.escaped.byStage));
    out.push("  原因:", ...listed(data.escaped.byCause));
  }
  out.push("");

  out.push("## 手戻り");
  if (data.rework.total === 0) out.push(`  ${none(any, "手戻り")}`);
  else out.push(`  ${data.rework.total} 件`, "  原因:", ...listed(data.rework.byCause));
  out.push("");

  out.push("## 人が見た範囲");
  if (data.sampled.length === 0) {
    out.push(`  ${none(any, "抜き取り確認")}`);
  } else {
    for (const s of data.sampled) {
      out.push(
        `  ${s.area}${s.fixed ? "（修正が入った）" : "（修正は入らなかった）"}`,
        `      見た: ${s.looked}`,
        `      **見ていない: ${s.notLooked}**`,
      );
    }
  }
  out.push("");

  out.push("## 任せる範囲を動かした根拠");
  if (data.boundaryChanges.length === 0) out.push(`  ${none(any, "委譲範囲の変更")}`);
  else {
    for (const b of data.boundaryChanges) {
      out.push(`  ${b.area}: ${b.from} → ${b.to}`, `      根拠: ${b.basis}`);
    }
  }
  out.push("");

  out.push("## 人を止めた回数");
  if (data.stops.total === 0) out.push(`  ${none(any, "停止")}`);
  else out.push(`  ${data.stops.total} 件`, ...listed(data.stops.byType));
  out.push("");

  // **言えないことを言う。** 出せる範囲を超えて読まれると、この証跡自体が誤りになる。
  out.push(
    "## この証跡が言っていないこと",
    "  - **プロダクトの品質が良いことを示していない。** 何を確かめたかを示しているだけである",
    "  - **確かめた手段が正しいことを示していない。** 通るテストは、何も見ていなくても通る",
    `  - **${QUALITY_FILE} に書かれていない確認は、ここに出ない。** 書かれていないだけの`,
    "    ものと、やっていないものは区別できない",
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
