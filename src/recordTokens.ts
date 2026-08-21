/**
 * トークン消費の記録。実行基盤のフックから呼ばれる。
 *
 * フックはトークン量を受け取らない。受け取るのはセッション記録への道筋
 * （transcript_path）と識別子だけである。したがってフックは引き金であり、
 * 値の出どころはセッション記録になる。
 *
 * 定義§16の補足により、トークン消費とモデル識別子はアダプタが自動で付与する。
 * ポート語彙には現れないため、スキルからは呼ばれない。
 */

import { basename, resolve } from "node:path";
import { KIT_VERSION } from "./kitVersion.ts";
import { readUsageSince } from "./transcript.ts";
import {
  appendEvent,
  currentWorkItem,
  cursorPath,
  readCursor,
  telemetryPath,
  writeCursor,
} from "./workItem.ts";

export interface HookInput {
  transcript_path?: unknown;
  session_id?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;
}

export interface RecordResult {
  written: number;
  path: string | null;
  note: string;
}

export function record(input: HookInput, root: string, now = new Date()): RecordResult {
  const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : "";
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (transcriptPath === "" || sessionId === "") {
    return { written: 0, path: null, note: "セッション記録の位置か識別子が渡されなかった" };
  }

  const cursor = cursorPath(root, sessionId);
  const from = readCursor(cursor);
  const { byModel, lines, lastUuid } = readUsageSince(transcriptPath, from);

  if (byModel.length === 0) {
    // 使用量が無くてもカーソルは進める。次回に同じ行を読み直さないため。
    writeCursor(cursor, lines, lastUuid);
    return { written: 0, path: null, note: "新しい使用量は無い" };
  }

  const item = currentWorkItem(root);
  const path = telemetryPath(root, item);
  const ts = now.toISOString();

  for (const usage of byModel) {
    appendEvent(path, {
      ts,
      // 作業単位が解決できない場合は null を書く。埋めずに残すことで、起票せずに
      // 始めた作業を verify が検出できる。握りつぶすと記録から消えてしまう。
      work_item_id: item?.workItemId ?? null,
      model: usage.model,
      kit_version: KIT_VERSION,
      emitter: "adapter",
      type: "tokens",
      session_id: sessionId,
      transcript: basename(transcriptPath),
      hook_event: typeof input.hook_event_name === "string" ? input.hook_event_name : null,
      responses: usage.responses,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      ...(item === null
        ? { unattributed_reason: "作業単位マーカーが無い。起票せずに作業した可能性がある" }
        : {}),
    });
  }

  writeCursor(cursor, lines, lastUuid);
  return {
    written: byModel.length,
    path,
    note: item === null ? "作業単位が解決できなかった" : `作業単位 ${item.workItemId}`,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);

if (invokedDirectly) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  let input: HookInput = {};
  try {
    const raw = await readStdin();
    if (raw.trim() !== "") input = JSON.parse(raw) as HookInput;
  } catch {
    // フックの入力が壊れていても、エージェントの動作は止めない。
  }
  const result = record(input, root);
  // 終了コードは常に 0。記録の失敗でエージェントを止めない（フックの非ブロッキング）。
  console.error(`record-tokens: ${result.written} 件 / ${result.note}`);
  process.exit(0);
}
