/**
 * Telemetry ポートの入口。
 *
 * 呼び出し側はここまでしか知らない。どこへどう書くかはアダプタの中にある。
 * 必須属性は受け取らない。渡せる形にすると、渡し忘れた記録と渡された記録が
 * 混ざり、遡って直せなくなる。
 */

import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { JsonlTelemetry } from "./adapters/telemetryJsonl.ts";

const USAGE = `記録を残す

  telemetry 停止を記録する   --kind <種別> --detail <内容> [--resolved]
  telemetry 修正を記録する   --target <対象> --detail <内容> [--cause <原因>] [--found-in <工程>]
  telemetry 抜き取り確認を記録する --area <領域> --looked <見た範囲> --not-looked <見なかった範囲>
                                 --detail <内容> [--fixed]
  telemetry 境界変更を記録する   --area <領域> --from <状態> --to <状態> --detail <内容> [--basis <根拠>]

  --root  記録の起点。既定は CLAUDE_PROJECT_DIR かカレントディレクトリ

原因は「要件のズレ」「設計のズレ」「実装バグ」のいずれか（定義§6）。
抜き取り確認は、修正が入らなかった場合も必ず記録すること（定義§8）。
--found-in を付けた修正は検出漏れとして記録される（定義§16）。
作業単位ID・モデル・参照実装の版・書き込み経路は自動で付く。渡さないこと。`;

// 語彙は定義§16の操作名で受ける。英語の別名も受けるが、正は日本語の操作名とする。
const OPERATIONS: Record<string, "stop" | "fix" | "sampling" | "boundary"> = {
  停止を記録する: "stop",
  修正を記録する: "fix",
  抜き取り確認を記録する: "sampling",
  境界変更を記録する: "boundary",
  stop: "stop",
  fix: "fix",
  sampling: "sampling",
  boundary: "boundary",
};

const CAUSES = ["要件のズレ", "設計のズレ", "実装バグ"];

export function run(argv: string[], root: string): { output: string; code: number } {
  const operation = OPERATIONS[argv[0] ?? ""];
  if (operation === undefined) return { output: USAGE, code: argv.length === 0 ? 0 : 2 };

  const { values } = parseArgs({
    args: argv.slice(1),
    options: {
      kind: { type: "string" },
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
  if (detail.trim() === "") return { output: "--detail は必須", code: 2 };
  if (values.cause !== undefined && !CAUSES.includes(values.cause)) {
    return { output: `--cause は ${CAUSES.join(" / ")} のいずれか`, code: 2 };
  }

  const telemetry = new JsonlTelemetry(values.root ?? root);

  if (operation === "stop") {
    if ((values.kind ?? "").trim() === "") return { output: "--kind は必須", code: 2 };
    telemetry.recordStop({ kind: values.kind as string, detail, resolved: values.resolved });
  } else if (operation === "fix") {
    if ((values.target ?? "").trim() === "") return { output: "--target は必須", code: 2 };
    telemetry.recordFix({
      target: values.target as string,
      detail,
      cause: values.cause,
      foundIn: values["found-in"],
    });
  } else if (operation === "sampling") {
    for (const key of ["area", "looked", "not-looked"] as const) {
      if ((values[key] ?? "").trim() === "") return { output: `--${key} は必須`, code: 2 };
    }
    telemetry.recordSampling({
      area: values.area as string,
      looked: values.looked as string,
      // 見なかった範囲は省略できない。見ていないのか、見て問題が無かったのかを
      // 区別できない記録は判断を誤らせる（定義§8）。
      notLooked: values["not-looked"] as string,
      fixed: values.fixed,
      detail,
    });
  } else {
    for (const key of ["area", "from", "to"] as const) {
      if ((values[key] ?? "").trim() === "") return { output: `--${key} は必須`, code: 2 };
    }
    telemetry.recordBoundaryChange({
      area: values.area as string,
      from: values.from as string,
      to: values.to as string,
      detail,
      basis: values.basis,
    });
  }

  const written = telemetry.lastWrite;
  if (written === null) return { output: "記録できなかった", code: 1 };
  return {
    output: written.attributed
      ? `記録した: ${written.path}`
      : `記録したが作業単位に紐づいていない: ${written.path}\n起票せずに作業していないか確認すること`,
    // 紐づかない記録は残すが、成功として返さない。握りつぶさず、気づける形にする。
    code: written.attributed ? 0 : 1,
  };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const { output, code } = run(process.argv.slice(2), root);
  (code === 0 ? console.log : console.error)(output);
  process.exit(code);
}
