/**
 * エージェントのセッション記録から使用量を読む。
 *
 * 実行基盤（Claude Code）が書く追記専用の JSONL。応答1件ごとに usage を持つ。
 * この層だけが記録の形式を知る。
 *
 * 費用は含まれない。保存もしない。単価表と掛けた値を保存すると、単価改定の
 * たびに過去の値が誤りになる。トークン量だけを記録し、費用は読むときに算出する。
 */

import { readFileSync } from "node:fs";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ModelUsage extends Usage {
  model: string;
  responses: number;
}

export interface TranscriptRead {
  /** モデル別の合計。使用量のあった応答が無ければ空。 */
  byModel: ModelUsage[];
  /** 読み終えた行数。次回のカーソルになる。 */
  lines: number;
  /** 最後に処理した応答の識別子。カーソルの健全性の確認に使う。 */
  lastUuid: string | null;
}

const USAGE_KEYS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
] as const;

function emptyUsage(model: string): ModelUsage {
  return {
    model,
    responses: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

/**
 * `from` 行目以降の使用量を読む。
 *
 * 記録は追記専用であることを前提とする。同じ応答が複数行に分かれることがあるため、
 * requestId で重複を除く。
 */
export function readUsageSince(path: string, from: number): TranscriptRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { byModel: [], lines: from, lastUuid: null };
  }

  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  const byModel = new Map<string, ModelUsage>();
  const seen = new Set<string>();
  let lastUuid: string | null = null;

  for (const line of lines.slice(from)) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 書き込み途中の行。次回の実行で読み直される
    }
    if (entry.type !== "assistant") continue;

    const message = entry.message as Record<string, unknown> | undefined;
    const usage = message?.usage as Record<string, unknown> | undefined;
    if (usage === undefined) continue;

    const requestId = String(entry.requestId ?? entry.uuid ?? "");
    if (requestId === "" || seen.has(requestId)) continue;
    seen.add(requestId);

    const model = String(message?.model ?? "unknown");
    const acc = byModel.get(model) ?? emptyUsage(model);
    acc.responses += 1;
    for (const key of USAGE_KEYS) {
      const value = usage[key];
      acc[key] += typeof value === "number" ? value : 0;
    }
    byModel.set(model, acc);
    lastUuid = typeof entry.uuid === "string" ? entry.uuid : lastUuid;
  }

  return { byModel: [...byModel.values()], lines: lines.length, lastUuid };
}

export function totalTokens(usage: Usage): number {
  return USAGE_KEYS.reduce((sum, key) => sum + usage[key], 0);
}
