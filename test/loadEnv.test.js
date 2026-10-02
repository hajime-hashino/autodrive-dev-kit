/**
 * エージェントが打つコマンドに、.env の資格情報を届ける（AUT-272）。
 *
 * **実行基盤が書き込み先を渡し、そこに書いた行をコマンドの前に読む。** ここでは
 * その手前まで——書いた行を読み込んだシェルから、値が見えるか——を確かめる。
 * 実行基盤そのものは起動しない（initEndToEnd.test.js と同じ理由）。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempDir } from "./helpers/tmp.js";

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "vendored", "hooks", "load-env");

/** フックを走らせ、書かれた行を読み込んだシェルの子から値を読む。 */
function seenBy(project, envFile) {
  execFileSync(HOOK, { env: { PATH: process.env.PATH, CLAUDE_ENV_FILE: envFile, CLAUDE_PROJECT_DIR: project } });
  return execFileSync("sh", ["-c", `. '${envFile}'; node -e 'console.log(process.env.PROBE ?? "MISSING")'`], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  }).trim();
}

test("書いた行を読んだコマンドの子から、.env の値が見える", () => {
  const project = tempDir("autodrive-load-env-");
  writeFileSync(join(project, ".env"), "PROBE=visible\n");
  assert.equal(seenBy(project, join(tempDir("autodrive-env-file-"), "env.sh")), "visible");
});

// **値は写さない。** 写すと、資格情報が置かれる場所がもう1つ増える。
test("値ではなく、読み込む行を書く", () => {
  const project = tempDir("autodrive-load-env-");
  writeFileSync(join(project, ".env"), "PROBE=secret-value\n");
  const envFile = join(tempDir("autodrive-env-file-"), "env.sh");
  seenBy(project, envFile);
  assert.equal(readFileSync(envFile, "utf8").includes("secret-value"), false, "値を写している");
});

// **開始の後に作った .env も拾う。** 行はコマンドの前に毎回読まれる。
test(".env が無くても落ちず、後から作られたものを拾う", () => {
  const project = tempDir("autodrive-load-env-");
  const envFile = join(tempDir("autodrive-env-file-"), "env.sh");
  execFileSync(HOOK, { env: { PATH: process.env.PATH, CLAUDE_ENV_FILE: envFile, CLAUDE_PROJECT_DIR: project } });
  const run = () =>
    execFileSync("sh", ["-c", `. '${envFile}'; echo "\${PROBE:-MISSING}"`], { encoding: "utf8", env: { PATH: process.env.PATH } }).trim();

  assert.equal(run(), "MISSING");
  writeFileSync(join(project, ".env"), "PROBE=later\n");
  assert.equal(run(), "later");
});

test("場所に引用符が含まれても、読み込める", () => {
  const project = join(tempDir("autodrive-load-env-"), "it's here");
  execFileSync("mkdir", ["-p", project]);
  writeFileSync(join(project, ".env"), "PROBE=quoted\n");
  assert.equal(seenBy(project, join(tempDir("autodrive-env-file-"), "env.sh")), "quoted");
});

// **書き込み先が無いなら何もしない。** エージェントを止めない。
test("書き込み先を渡されなければ、何も書かずに 0 で終わる", () => {
  const project = tempDir("autodrive-load-env-");
  execFileSync(HOOK, { env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: project } });
  assert.equal(existsSync(join(project, "env.sh")), false);
});
