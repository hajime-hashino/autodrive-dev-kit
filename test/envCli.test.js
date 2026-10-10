/**
 * 資格情報の有無を、値を出さずに確かめる（AUT-275）。
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../src/vendored/internal/envCli.js";
import { tempDir } from "./helpers/tmp.js";

const VALUE = "cf-dummy-0123456789abcdef";

test("set / empty / unset だけを出し、値を出さない", () => {
  const { output, code } = run(["check", "A", "B", "C"], { A: VALUE, B: "" }, tempDir("autodrive-env-"));
  assert.equal(output.includes(VALUE), false, "値を出している");
  assert.match(output, /^A\s+set$/m);
  // **空と未設定を分ける。** .env を写すと `NAME=` が残り、空文字が渡る。
  assert.match(output, /^B\s+empty$/m);
  assert.match(output, /^C\s+unset$/m);
  assert.equal(code, 1);
});

test("すべて入っていれば 0 で終わる", () => {
  assert.equal(run(["check", "A"], { A: VALUE }, tempDir("autodrive-env-")).code, 0);
});

// **.env にあるのに届いていなければ、そう言う。** 読み込みが効いていない兆候である（AUT-272）。
test(".env にあるのに環境に無ければ、読み込まれていないと言う", () => {
  const root = tempDir("autodrive-env-");
  writeFileSync(join(root, ".env"), `A=${VALUE}\n`);
  const { output } = run(["check", "A"], {}, root);
  assert.match(output, /not loaded/, output);
  assert.equal(output.includes(VALUE), false, "値を出している");
});

test("名前でないものは受け取らない", () => {
  assert.equal(run(["check", "$A"], {}, tempDir("autodrive-env-")).code, 2);
});
