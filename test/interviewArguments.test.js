/**
 * 引数で答える（AUT-271）。
 *
 * **端末が無い呼び出し手でも、構成を渡せること。** `init` をエージェントに打たせると、
 * `/dev/tty` を開けず答えを渡せなかった。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { argumentInterview, readAnswers } from "../src/vendored/internal/adapters/interviewArguments.js";
import { runSetup } from "../src/vendored/internal/cli.js";
import { CONFIG_FILE, readConfig } from "../src/vendored/internal/config.js";
import { LANGUAGE_QUESTION, QUESTIONS, askPrefix } from "../src/vendored/internal/setup.js";
import { useRecommended } from "../src/vendored/internal/ports/interview.js";
import { tempDir } from "./helpers/tmp.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project() {
  const root = tempDir("autodrive-args-");
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

/** 位置で引かない（setup.test.js と同じ理由）。 */
const ask = (port) => {
  const found = QUESTIONS.find((q) => q.port === port);
  assert.notEqual(found, undefined, `問いが無い: ${port}`);
  return found;
};

// ---------------------------------------------------------------- 読む

test("問いごとの名前で答えを受け取る", () => {
  const { answers, error } = readAnswers([
    "--language", "ja", "--tracker", "github-issues", "--preview", "none", "--sandbox", "orca", "--prefix", "APP",
  ]);
  assert.equal(error, null);
  assert.deepEqual(answers, { language: "ja", tracker: "github-issues", preview: "none", sandbox: "orca", prefix: "APP" });
});

test("何も渡さなければ、答えは空", () => {
  assert.deepEqual(readAnswers([]), { answers: {}, error: null });
});

// **飲み込まない。** 推奨に倒すと、指定したつもりの人が、効かなかったことに気づけない。
test("選択肢に無い値は受け取らず、通る値を出す", () => {
  const { error } = readAnswers(["--tracker", "jira"]);
  assert.ok(error?.includes("--tracker jira"), error ?? "");
  assert.ok(error?.includes("linear / github-issues"), error ?? "");
});

test("形に合わない接頭辞は受け取らない", () => {
  const { error } = readAnswers(["--prefix", "app"]);
  assert.ok(error?.includes("--prefix app"), error ?? "");
});

test("知らない引数は受け取らず、渡せるものを出す", () => {
  const { error } = readAnswers(["--trackr", "linear"]);
  assert.notEqual(error, null);
  assert.ok(error?.includes("--tracker"), error ?? "");
});

// **選択肢の写しを持たない。** 増えたときに片方だけ古くなる。
test("問いにある選択肢は、すべて引数でも通る", () => {
  for (const q of QUESTIONS) {
    for (const c of q.choices) {
      assert.equal(readAnswers([`--${q.port}`, c.value]).error, null, `${q.port} ${c.value}`);
    }
  }
  for (const c of LANGUAGE_QUESTION.choices) {
    assert.equal(readAnswers(["--language", c.value]).error, null, c.value);
  }
});

// ---------------------------------------------------------------- 答える

test("渡された問いには答え、渡されなかった問いは次の聞き方へ回す", () => {
  const passed = [];
  const fallback = {
    answer(q) {
      passed.push(q.port ?? q.name);
      return null;
    },
  };
  const port = argumentInterview({ language: "ja", tracker: "github-issues" }, fallback);

  assert.equal(port.answer(LANGUAGE_QUESTION), "ja");
  assert.equal(port.answer(ask("tracker")), "github-issues");
  assert.equal(port.answer(ask("preview")), null);
  assert.deepEqual(passed, ["preview"], "答えたものまで聞いている");
});

test("接頭辞も引数で答えられる", () => {
  const port = argumentInterview({ prefix: "APP" }, useRecommended);
  const { prefix, how } = askPrefix(port, "en", "something-else");
  assert.equal(prefix, "APP");
  assert.ok(how.includes("you chose"), how);
});

test("聞かれなかった答えを数える", () => {
  const port = argumentInterview({ tracker: "linear", prefix: "APP" }, useRecommended);
  port.answer(ask("tracker"));
  assert.deepEqual(port.unused(), ["prefix"]);
});

// ---------------------------------------------------------------- 入口

test("使われなかった答えがあれば、そう出す", () => {
  const { output, code } = runSetup("init", project(), useRecommended, ["--tracker", "linear", "--prefix", "APP"]);
  assert.equal(code, 0, output);
  assert.ok(output.includes("Not used: --prefix"), output);
});

test("読めない答えなら、何も置かずに止まる", () => {
  const root = project();
  const { output, code } = runSetup("init", root, useRecommended, ["--preview", "vercel"]);
  assert.equal(code, 2);
  assert.ok(output.includes("Nothing was placed"), output);
  assert.equal(existsSync(join(root, CONFIG_FILE)), false, "止めたのに置いている");
});

// **入れ替えは聞かない。** 黙って捨てると、構成を変えたつもりで変わっていない。
test("入れ替えに答えを渡したら、受け取らずに止まる", () => {
  const { output, code } = runSetup("update", project(), useRecommended, ["--tracker", "linear"]);
  assert.equal(code, 2);
  assert.ok(output.includes("update does not take answers"), output);
});

// **端末を持たない呼び出しで、実際に通ること。** 標準入力を閉じて打つ。
test("端末が無くても、引数で渡した構成のとおりに置かれる", () => {
  const root = project();
  execFileSync(
    join(KIT, "src", "vendored", "bin", "autodrive-dev-kit"),
    ["init", "--language", "ja", "--tracker", "github-issues", "--prefix", "APP", "--preview", "none", "--sandbox", "none"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );

  const { config } = readConfig(root);
  assert.equal(config?.language, "ja");
  assert.equal(config?.ports.tracker, "github-issues");
  assert.equal(config?.tracker.prefix, "APP");
  assert.equal(config?.ports.preview, "none");
  assert.equal(config?.ports.sandbox, "none");
});
