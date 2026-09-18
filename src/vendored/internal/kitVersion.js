/**
 * 記録に付ける参照実装のバージョン。
 *
 * **ファイルから読む。** プロジェクトへ複製されたとき、複製された時点のバージョンが
 * そのまま付いてほしい。定数で持つと、複製の際に書き換えが要る。
 *
 * バージョンが意味を持つのは、プロジェクトごとに違うバージョンで動きうるからである。定義§6が
 * `kit_version` を必須属性としているのは、記録を後から比べるためであり、
 * 全部が同じ値なら比べようがない。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 探す場所。**参照実装の中と複製先とで、位置が違う。**
 *
 * 複製先では添えもの（VERSION / LICENSE / NOTICE / package.json）が複製の直下に来る。
 * 参照実装の中では、それらはリポジトリの直下にある——npm も Apache-2.0 もそこにあること
 * を前提にしているため、`src/vendored/` の中へは入れていない（AUT-202）。
 *
 * **その食い違いを、ここだけで吸収する。** 各所で分岐させると、同じ判断が散る。
 */
const RUN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = [RUN_ROOT, resolve(RUN_ROOT, "..", "..")];

function read() {
  for (const root of ROOTS) {
    const path = join(root, "VERSION");
    if (!existsSync(path)) continue;
    const value = readFileSync(path, "utf8").trim();
    if (value !== "") return value;
  }
  return "不明";
}

export const KIT_VERSION = read();
