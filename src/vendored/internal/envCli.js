/**
 * 資格情報が入っているかを、値を出さずに確かめる（AUT-275）。
 *
 * **確かめる式を手で書かせない。** `echo "${v:+set}${v:-EMPTY}"` は、値が入って
 * いるときに値そのものを出す。実際にこれで API トークン2つが会話の記録に残った。
 * 正しい式を手引きに書くだけでは、次も誰かが書き間違える。**書かずに済む道を置く。**
 *
 * 出すのは `set` / `empty` / `unset` の3つだけ。**空と未設定を分ける。** `.env` を
 * 写して作ると `NAME=` の行が残り、空文字が渡る。`??` で既定に落ちる書き方では、
 * 空文字は既定に落ちない。
 *
 * **見るのは、このコマンドが受け取った環境である。** エージェントのコマンドと同じ
 * もの（load-env が読み込んだ `.env`）を見る。`.env` にはあるのに環境に無い場合は、
 * そう言う。読み込みが効いていない兆候である。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "./redactSecrets.js";

const USAGE = `Check whether credentials are set, without printing their values

  env check <NAME>...

Prints one of set / empty / unset for each name. **Never prints a value.**
Exits with 1 if any of them is not set.

Use this instead of echo, printenv, or cat .env. An expression such as
echo "\${v:+set}\${v:-EMPTY}" prints the value itself when it is set.`;

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @param {string} root `.env` を探す場所
 */
export function run(argv, env, root) {
  if (argv[0] !== "check" || argv.length < 2) return { output: USAGE, code: argv.length === 0 ? 0 : 2 };

  const names = argv.slice(1);
  const bad = names.filter((n) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
  if (bad.length > 0) return { output: `Not an environment variable name: ${bad.join(" ")}`, code: 2 };

  const envPath = join(root, ".env");
  const inFile = new Set(existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")).map((e) => e.name) : []);

  const width = Math.max(...names.map((n) => n.length));
  let missing = false;
  const lines = names.map((name) => {
    const value = env[name];
    const state = value === undefined ? "unset" : value === "" ? "empty" : "set";
    if (state !== "set") missing = true;
    // **.env にあるのに届いていない場合は、そう言う。** 中身ではなく、読み込みの問題である。
    const hint = state === "unset" && inFile.has(name) ? "  (it is in .env, but not loaded into this environment)" : "";
    return `${name.padEnd(width)}  ${state}${hint}`;
  });
  return { output: lines.join("\n"), code: missing ? 1 : 0 };
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = run(process.argv.slice(2), process.env, process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  (code === 0 ? console.log : console.error)(output);
  process.exit(code);
}
