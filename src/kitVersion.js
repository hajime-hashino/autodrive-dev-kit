/**
 * 記録に付ける参照実装の版。
 *
 * **ファイルから読む。** プロジェクトへ複製されたとき、複製された時点の版が
 * そのまま付いてほしい。定数で持つと、複製の際に書き換えが要る。
 *
 * 版が意味を持つのは、プロジェクトごとに違う版で動きうるからである。定義§6が
 * `kit_version` を必須属性としているのは、記録を後から比べるためであり、
 * 全部が同じ値なら比べようがない。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read() {
  const path = join(ROOT, "VERSION");
  if (!existsSync(path)) return "不明";
  const value = readFileSync(path, "utf8").trim();
  return value === "" ? "不明" : value;
}

export const KIT_VERSION = read();
