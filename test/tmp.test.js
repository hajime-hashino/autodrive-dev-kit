/**
 * 判定が、作業用の置き場を残さないこと。
 *
 * ## なぜ判定するか
 *
 * 残していた。サンドボックスの **inode を使い切り、書き込みが一切できなくなった**
 * （AUT-147）。`/tmp` に 41,018 個あり、`npm test` 1回で 187 個増えていた。
 * 変異テストは判定を20回以上まわすため、1回打つごとに数千個積み上がる。
 *
 * ## なぜ気づかなかったか
 *
 * **CI では出ない。** 毎回新しい実行環境なので1回分しか溜まらない。手元と
 * サンドボックスでだけ効く。止まり方も紛らわしく、`df -h` は空きがあると答える
 * （尽きたのは容量ではなく inode）。
 *
 * ## 何を見るか
 *
 * 1. 置き場が、プロセスの終わりに実際に消えること。**子プロセスで確かめる。**
 *    いまのプロセスでは、終わってからでないと確かめられない
 * 2. 判定が `mkdtempSync` を直に呼んでいないこと。**呼べば片付けの外へ出る**
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir, tempRoot, madeTempDirs } from "./helpers/tmp.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELPER = join(KIT, "test", "helpers", "tmp.js");

test("置き場は、プロセスが終わるときに消える", () => {
  // **子プロセスで見る。** いまのプロセスの終わりは、ここからは観測できない。
  const script = `
    import { tempDir } from ${JSON.stringify(HELPER)};
    import { writeFileSync } from "node:fs";
    import { join } from "node:path";
    const d = tempDir("autodrive-片付け-");
    // 中身があっても消えること。空のときだけ消えるのでは足りない。
    writeFileSync(join(d, "中身.txt"), "x", "utf8");
    console.log(d);
  `;
  const made = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  }).trim();

  assert.notEqual(made, "", "置き場のパスを受け取れていない。判定が空回りしている");
  assert.equal(existsSync(made), false, `**置き場が残っている**: ${made}`);
});

test("落ちて終わっても、置き場を残さない", () => {
  const script = `
    import { tempDir } from ${JSON.stringify(HELPER)};
    const d = tempDir("autodrive-落ちる-");
    console.log(d);
    throw new Error("わざと落とす");
  `;
  let made = "";
  try {
    execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    assert.fail("落ちていない。判定になっていない");
  } catch (error) {
    made = String(error.stdout ?? "").trim();
  }
  assert.notEqual(made, "", "置き場のパスを受け取れていない");
  assert.equal(existsSync(made), false, `**落ちたときに残っている**: ${made}`);
});

// **名前によらず片付くこと。** 判定は都合の良い名前を付ける（サンドボックスの名前を
// 見る判定は `my-app-` を使う）。掃く側は名前を知らないため、名前で拾う形だと
// 漏れる。実際に2件漏れていた（AUT-147）。
test("どんな名前で作っても、1つの親の下に入る", () => {
  const before = madeTempDirs();
  const a = tempDir("autodrive-数える-");
  const b = tempDir("my-app-");
  assert.equal(madeTempDirs(), before + 2, "作ったものを数えていない");
  assert.notEqual(tempRoot(), null, "親を作っていない");
  for (const p of [a, b]) {
    assert.ok(p.startsWith(`${tempRoot()}/`), `親の外に作っている: ${p}`);
  }
});

// **直に呼ばれると、片付けの外へ出る。** 1箇所でも外れると、そこから溜まり続ける。
test("判定が、置き場を直に作っていない", () => {
  const offenders = [];
  for (const name of readdirSync(join(KIT, "test"))) {
    if (!name.endsWith(".test.js")) continue;
    const body = readFileSync(join(KIT, "test", name), "utf8");
    // `mkdtempSync` を呼んでいる行だけを見る。import は片付けの外ではない。
    for (const [i, line] of body.split("\n").entries()) {
      if (/mkdtempSync\s*\(/.test(line)) offenders.push(`${name}:${i + 1}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `直に作っている箇所がある。test/helpers/tmp.js の tempDir を使うこと:\n${offenders.join("\n")}`,
  );
});
