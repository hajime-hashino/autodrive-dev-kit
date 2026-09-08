/**
 * テストが使う作業用の置き場。**必ず片付ける。**
 *
 * ## なぜ作ったか
 *
 * 判定が `mkdtempSync` で作った置き場を、**一度も消していなかった。** サンドボックスの
 * inode を使い切り、書き込みが一切できなくなった（AUT-147）。
 *
 * ```
 * overlay  1966080 IUsed  0 IFree  100% IUse%
 * /tmp に 41,018 個
 * ```
 *
 * **変異テストが効く。** 判定を20回以上まわすため、1回打つごとに数千個積み上がる。
 *
 * ## なぜ気づきにくいか
 *
 * **CI では出ない。** 毎回新しい実行環境なので、1回分しか溜まらない。手元と
 * サンドボックスでだけ、じわじわ効く。
 *
 * 止まり方も原因に結びつかない。`No space left on device` と出るが、`df -h` は
 * 空きがあると答える。**尽きたのは容量ではなく inode である。**
 *
 * ## 何を保証するか
 *
 * ここを通して作れば、**プロセスが終わるときに消える。** 個々の判定が後始末を
 * 覚えている必要は無い。覚えていないと消えない形にすると、また同じことが起きる。
 *
 * 保証しないのは、`SIGKILL` のように後始末の機会そのものが無い終わり方である。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** この実行が使う親の置き場。**1つにまとめる。** */
let parent = null;
/** 作った数。判定のために数える。 */
let made = 0;

/**
 * 作業用の置き場を作る。**呼んだ側は消さなくてよい。**
 *
 * **すべて1つの親の下に作る。** 名前は判定の都合で自由に付けられる一方
 * （サンドボックスの名前を見る判定は `my-app-` を使う）、掃く側は名前を知らない。
 * 親でまとめておけば、**名前によらず一度に片付く**（AUT-147）。
 *
 * @param {string} prefix 何のための置き場かが分かる名前
 * @returns {string} 作られた置き場のパス
 */
export function tempDir(prefix = "autodrive-") {
  if (parent === null) {
    parent = mkdtempSync(join(tmpdir(), "autodrive-tests-"));
    // **登録は一度だけ。** 呼ぶたびに足すと、上限に当たって警告が出る。
    process.on("exit", cleanupTempDirs);
  }
  made += 1;
  return mkdtempSync(join(parent, prefix));
}

/** 親の置き場。まだ作っていなければ null。 */
export function tempRoot() {
  return parent;
}

/** 作った数。 */
export function madeTempDirs() {
  return made;
}

/** 親ごと消す。**中の名前を知らなくても片付く。** */
export function cleanupTempDirs() {
  if (parent === null) return;
  try {
    rmSync(parent, { recursive: true, force: true });
  } catch {
    // 消せなければ諦める。**掃除の失敗で、判定の結果を変えない。**
  }
  parent = null;
}
