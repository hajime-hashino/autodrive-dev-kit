/**
 * セッション由来の状態。
 *
 * 必須属性のうち `model` はランタイム由来であり、呼び出し側は知らない
 * （定義§16の補足「アダプタが自動で付与する」）。トークン消費のフックが
 * セッション記録から読んだ値をここへ置き、記録の語彙から使う。
 *
 * 作業状態であって成果物ではないため、リポジトリには入れない。
 *
 * ## 書く場所は1つ、読む場所は多い
 *
 * **これはセッションの状態であって、リポジトリの状態ではない。** 1つのセッションに
 * 1つの値であり、書かれるのはフックが走った場所——作業場の起点——だけである。
 *
 * 一方、記録は子リポジトリの中から打たれる。**起点の探し上げは `.autodrive` を持つ
 * 最初のディレクトリで止まる**（`findRoot`）ため、子で止まり、そこには
 * `session.json` が無い。
 *
 * ```
 * autodrive-dev-kit/.autodrive/   current-work-item.json, work-items.json   ← ここで止まる
 * autodrive-dev-work/.autodrive/  … session.json                            ← 値はここ
 * ```
 *
 * **AUT-221 の修正が、この状態を作った。** 作業状態のマーカーを両方の起点へ置く
 * ようにしたため、子が `.autodrive` を持つようになった。それまでは子に無かったので、
 * 探し上げが作業場まで届いていた。
 *
 * 結果、**必須属性である `model` が、直近10件のうち6件で欠けた**（AUT-231）。
 * 定義§6はこれを後から遡って付与できないとしている。**取り戻せない。**
 *
 * **読むときは、見つかるまで上へ辿る。** 複製して持たせない。1つの値を2箇所に
 * 置くと、片方だけが古くなる（定義§16の記録規約と同じ理由）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { STATE_DIR } from "./workItem.js";

/** @typedef {{ session_id: string | null, last_model: string | null, updated: string | null }} SessionState */
const EMPTY = { session_id: null, last_model: null, updated: null };

export function sessionStatePath(root) {
  return join(root, STATE_DIR, "session.json");
}

/**
 * セッションの記録を探す。**見つかるまで上へ辿る。**
 *
 * **`findRoot` を使わない。** あれは `.autodrive` があれば止まるが、ここで要るのは
 * `session.json` がある場所である。**器があることと、中身があることは違う。**
 *
 * @param {string} root
 * @returns {string | null} 見つかった場所。無ければ null
 */
export function findSessionState(root) {
  let dir = resolve(root);
  for (;;) {
    const path = sessionStatePath(dir);
    if (existsSync(path)) return path;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function readSessionState(root) {
  const path = findSessionState(root);
  if (path === null) return EMPTY;
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
