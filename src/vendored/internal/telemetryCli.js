/**
 * Telemetry ポートの入口。
 *
 * 呼び出し側はここまでしか知らない。どこへどう書くかはアダプタの中にある。
 * 必須属性は受け取らない。渡せる形にすると、渡し忘れた記録と渡された記録が
 * 混ざり、遡って直せなくなる。
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { JsonlTelemetry } from "./adapters/telemetryJsonl.js";
import { defaultRoot, resolveWorkItem } from "./workItem.js";
import { STOP_TYPES } from "./ports/telemetry.js";


const USAGE = `Leave records

  telemetry 停止を記録する   --kind <kind> --type <入力|手戻り> --detail <details> [--resolved]      Record stop
  telemetry 手戻りを記録する   --target <target> --detail <details> [--cause <cause>] [--found-in <stage>]      Record rework
  telemetry 抜き取り確認を記録する --area <area> --looked <range looked at> --not-looked <range not looked at>
                                 --detail <details> [--fixed]      Record spot check
  telemetry 委譲範囲の変更を記録する   --area <area> --from <state> --to <state> --detail <details> [--basis <ground>]      Record delegation change

  --root  Where records start from. Defaults to CLAUDE_PROJECT_DIR or the current directory

The kind of stop (--type) is 「入力」 (input) or 「手戻り」 (rework). **Not every stop is something to reduce.**
Stops to obtain input (hearing requirements, deciding how it looks, issuing credentials) are evidence that the method
is working correctly. **Asking the same thing again is rework, not input.**

The cause is one of 「要件のズレ」 (requirements drift), 「設計のズレ」 (design drift), 「実装バグ」 (implementation bug) (definition §6).
Always record spot checks, even when nothing was corrected (definition §8).
A fix with --found-in is recorded as a missed detection (definition §16).
The work item ID, model, autodrive-dev-kit version, and write path are attached automatically. Do not pass them.`;

// 語彙は定義§16の操作名で受ける。英語の別名も受けるが、正は日本語の操作名とする。
export const OPERATIONS = {
  停止を記録する: "stop",
  手戻りを記録する: "fix",
  抜き取り確認を記録する: "sampling",
  委譲範囲の変更を記録する: "boundary",
  stop: "stop",
  fix: "fix",
  sampling: "sampling",
  boundary: "boundary",
};

/**
 * 前の名前。**当面は受け付ける。**
 *
 * 定義 v0.14 で語彙が変わった（AUT-133）。既に配った先の呼び出しが黙って壊れると、
 * **記録が落ちる。** 記録は遡って付け直せないため、落ちた分は戻らない。
 *
 * **ただし、同じものに名前が2つある状態そのものが、今回直した欠陥である。**
 * 移行のための措置であり、残し続けない。使われたら、新しい名前を出して知らせる。
 *
 * **落とす条件**: 配った先すべてが v0.14 以降の語彙に移ったことを確かめたとき。
 * いまの配布先は2つ（agent-playground / enaction-platform）。
 */
export const RENAMED = {
  修正を記録する: "手戻りを記録する",
  境界変更を記録する: "委譲範囲の変更を記録する",
};

const CAUSES = ["要件のズレ", "設計のズレ", "実装バグ"];

export function run(argv , root) {
  const given = argv[0] ?? "";
  const renamedTo = RENAMED[given];
  const operation = OPERATIONS[given] ?? (renamedTo === undefined ? undefined : OPERATIONS[renamedTo]);
  if (operation === undefined) return { output: USAGE, code: argv.length === 0 ? 0 : 2 };

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      kind: { type: "string" },
      type: { type: "string" },
      detail: { type: "string" },
      resolved: { type: "boolean", default: false },
      target: { type: "string" },
      cause: { type: "string" },
      "found-in": { type: "string" },
      area: { type: "string" },
      looked: { type: "string" },
      "not-looked": { type: "string" },
      fixed: { type: "boolean", default: false },
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string" },
      root: { type: "string" },
    },
    strict: true,
  });

  const detail = values.detail ?? "";
  if (detail.trim() === "") return { output: "--detail is required", code: 2 };
  if (values.cause !== undefined && !CAUSES.includes(values.cause)) {
    return { output: `--cause must be one of ${CAUSES.join(" / ")}`, code: 2 };
  }

  const telemetry = new JsonlTelemetry(values.root ?? root);

  if (operation === "stop") {
    if ((values.kind ?? "").trim() === "") return { output: "--kind is required", code: 2 };
    // **省略できる形にしない。** 既定値を置くと、考えずに通る側へ倒れる。
    // 定義§6は記録の時点で区別することを求めており、後から分類し直すと解釈が入る。
    if (!(STOP_TYPES).includes(values.type ?? "")) {
      return {
        output:
          `--type must be one of ${STOP_TYPES.join(" / ")}\n\n` +
          "  入力 (input)     hearing what to build, deciding how it looks, agreeing on the order, issuing credentials\n" +
          "                   the method is working correctly. Not something to reduce\n" +
          "  手戻り (rework)  the understanding was different, something has to be rebuilt, it was sent back at approval\n" +
          "                   something to reduce\n\n" +
          "**Asking the same thing again is rework, not input.**",
        code: 2,
      };
    }
    telemetry.recordStop({
      kind: values.kind ,
      stopType: values.type ,
      detail,
      resolved: values.resolved,
    });
  } else if (operation === "fix") {
    if ((values.target ?? "").trim() === "") return { output: "--target is required", code: 2 };
    telemetry.recordFix({
      target: values.target ,
      detail,
      cause: values.cause,
      foundIn: values["found-in"],
    });
  } else if (operation === "sampling") {
    for (const key of ["area", "looked", "not-looked"] ) {
      if ((values[key] ?? "").trim() === "") return { output: `--${key} is required`, code: 2 };
    }
    telemetry.recordSampling({
      area: values.area ,
      looked: values.looked ,
      // 見なかった範囲は省略できない。見ていないのか、見て問題が無かったのかを
      // 区別できない記録は判断を誤らせる（定義§8）。
      notLooked: values["not-looked"] ,
      fixed: values.fixed,
      detail,
    });
  } else {
    for (const key of ["area", "from", "to"] ) {
      if ((values[key] ?? "").trim() === "") return { output: `--${key} is required`, code: 2 };
    }
    telemetry.recordBoundaryChange({
      area: values.area ,
      from: values.from ,
      to: values.to ,
      detail,
      basis: values.basis,
    });
  }

  const written = telemetry.lastWrite;
  if (written === null) return { output: "Could not record", code: 1 };
  // **理由をそのまま出す。** 紐づく先が無いのか、マーカーが壊れているのかで、
  // 人がやることが違う。同じ言葉で報告すると、違うところを探すことになる。
  const reason = resolveWorkItem(root).unattributedReason ?? "Could not identify the reason";
  // **古い名前で呼ばれたら、新しい名前を出す。** 黙って受け入れると、いつまでも
  // 2つの名前が生き続ける。移行のための措置であり、残し続けるものではない。
  const notice =
    renamedTo === undefined
      ? ""
      : `\n("${given}" has been renamed to "${renamedTo}". Use that from now on)`;
  return {
    output: written.attributed
      ? `Recorded: ${written.path}${notice}`
      : `Recorded, but not linked to a work item: ${written.path}\n${reason}${notice}`,
    // 紐づかない記録は残すが、成功として返さない。捨てずに、気づける形にする。
    code: written.attributed ? 0 : 1,
  };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const root = defaultRoot();
  const { output, code } = run(process.argv.slice(2), root);
  (code === 0 ? console.log : console.error)(output);
  process.exit(code);
}
