/**
 * セッション由来の状態。
 *
 * 必須属性のうち `model` はランタイム由来であり、呼び出し側は知らない
 * （定義§16の補足「アダプタが自動で付与する」）。トークン消費のフックが
 * セッション記録から読んだ値をここへ置き、記録の語彙から使う。
 *
 * 作業状態であって成果物ではないため、リポジトリには入れない。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STATE_DIR } from "./workItem.js";

/** @typedef {{ session_id: string | null, last_model: string | null, updated: string | null }} SessionState */
const EMPTY = { session_id: null, last_model: null, updated: null };

export function sessionStatePath(root) {
  return join(root, STATE_DIR, "session.json");
}

export function readSessionState(root) {
  const path = sessionStatePath(root);
  if (!existsSync(path)) return EMPTY;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      session_id: typeof parsed.session_id === "string" ? parsed.session_id : null,
      last_model: typeof parsed.last_model === "string" ? parsed.last_model : null,
      updated: typeof parsed.updated === "string" ? parsed.updated : null,
    };
  } catch {
    return EMPTY;
  }
}

export function writeSessionState(root , state) {
  const path = sessionStatePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state)}\n`, "utf8");
}
