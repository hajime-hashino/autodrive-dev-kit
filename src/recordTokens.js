/**
 * トークン消費の記録。実行基盤のフックから呼ばれる。
 *
 * フックはトークン量を受け取らない。受け取るのはセッション記録への道筋
 * （transcript_path）と識別子だけである。したがってフックはきっかけであり、
 * 値の出どころはセッション記録になる。
 *
 * 定義§16の補足により、モデル識別子はアダプタが自動で付与する。ポート語彙には
 * 現れないため、スキルからは呼ばれない。
 *
 * ## リポジトリへ書かない
 *
 * **トークン消費は任意の記録対象である**（定義§6、v0.16）。そして書かれるのは
 * コミットと提出の後なので、**その作業単位の提出には構造的に間に合わない。**
 *
 * 以前は次の着手のときに拾ってコミットしていたが、拾えるのは同じ作業ツリーが
 * 残っている場合に限られ、**作業単位ごとにワークツリーを捨てる並列実行では
 * 拾う機会が消える**（AUT-162）。拾えた場合も、次の作業単位の提出に無関係な
 * 変更が混ざる。
 *
 * **したがって、行き先は作業ツリーの外にする**（`adapters/tokensOtlp.js`）。
 *
 * ## モデル識別子は、ここで止めない
 *
 * **送り先が無くても、セッションの状態は必ず書く。** §6の他の5つの記録が持つ
 * `model` は、ここが書いた値を読んでいる。**モデル識別子は必須属性のままである**
 * （定義§6・§16補足）。束ねて止めると、必須のものまで落ちる。
 */

import { basename, resolve } from "node:path";
import { KIT_VERSION } from "./kitVersion.js";
import { readUsageSince } from "./transcript.js";
import { writeSessionState } from "./sessionState.js";
import { buildPayload, otlpTarget, send } from "./adapters/tokensOtlp.js";
import { resolveWorkItem, cursorPath, readCursor, writeCursor } from "./workItem.js";

/** @typedef {{ transcript_path?: unknown, session_id?: unknown, cwd?: unknown, hook_event_name?: unknown }} HookInput */
/** @typedef {{ sent: number, note: string }} RecordResult */
export async function record(input, root, now = new Date(), env = process.env, deps = {}) {
  const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : "";
  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  if (transcriptPath === "" || sessionId === "") {
    return { sent: 0, note: "セッション記録の位置か識別子が渡されなかった" };
  }

  const cursor = cursorPath(root, sessionId);
  const from = readCursor(cursor);
  const { byModel, lines, lastUuid } = readUsageSince(transcriptPath, from);

  if (byModel.length === 0) {
    // 使用量が無くてもカーソルは進める。次回に同じ行を読み直さないため。
    writeCursor(cursor, lines, lastUuid);
    return { sent: 0, note: "新しい使用量は無い" };
  }

  const ts = now.toISOString();

  // **送り先の有無に関わらず、必ず先に書く。** §6の他の記録が持つ `model` は
  // ここが出どころであり、モデル識別子は必須属性のままである（定義§6）。
  const latest = byModel.reduce((a, b) => (b.responses > a.responses ? b : a));
  writeSessionState(root, { session_id: sessionId, last_model: latest.model, updated: ts });

  const target = otlpTarget(env);
  if (target === null) {
    // **送り先が無いのは、壊れているのではない。** トークン消費は任意の記録対象
    // であり（定義§6 v0.16）、設定しない構成が成立する。
    //
    // カーソルは進める。**記録しないことを選んでいる以上、貯めて後で送る相手が
    // 居ない。** 進めないと、後で設定したときに過去の全量がその時点の作業単位へ
    // 付いてしまう。
    writeCursor(cursor, lines, lastUuid);
    return { sent: 0, note: "送り先が設定されていない（AUTODRIVE_OTLP_ENDPOINT）。トークン消費は記録しない" };
  }

  const { item, unattributedReason } = resolveWorkItem(root);
  const payload = buildPayload({
    usages: byModel.map((u) => (item === null ? { ...u, unattributedReason } : u)),
    workItemId: item?.workItemId ?? null,
    sessionId,
    kitVersion: KIT_VERSION,
    repo: item === null ? null : basename(item.repoPath),
    now,
  });

  const result = await send(payload, target, deps);
  if (!result.ok) {
    // **カーソルを進めない。** 進めると、送れなかった分がそのまま消える。
    // 次に走ったときに、まとめて送り直される。
    return { sent: 0, note: `${result.note}（次回に送り直す）` };
  }

  writeCursor(cursor, lines, lastUuid);
  return {
    sent: byModel.length,
    note: item === null ? "作業単位が解決できなかった" : `作業単位 ${item.workItemId}`,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);

if (invokedDirectly) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  let input = {};
  try {
    const raw = await readStdin();
    if (raw.trim() !== "") input = JSON.parse(raw);
  } catch {
    // フックの入力が壊れていても、エージェントの動作は止めない。
  }
  // 送信に失敗しても、ここで投げさせない。**フックはエージェントを止めない。**
  const result = await record(input, root).catch((e) => ({
    sent: 0,
    note: `記録の途中で落ちた: ${e instanceof Error ? e.message : String(e)}`,
  }));
  // 終了コードは常に 0。記録の失敗でエージェントを止めない（フックの非ブロッキング）。
  console.error(`record-tokens: ${result.sent} 件 / ${result.note}`);
  process.exit(0);
}
