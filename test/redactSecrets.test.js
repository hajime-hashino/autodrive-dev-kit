/**
 * 秘密の値が出力に出たら、AI に届く前に置き換える（AUT-275）。
 *
 * **実行基盤そのものは起動しない**（initEndToEnd.test.js と同じ理由）。実行基盤が
 * `updatedToolOutput` を受け取って置き換えることは、Claude Code 2.1.241 で実測した
 * （作業単位の本文）。ここで確かめるのは、**その形で返しているか**である。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { NOT_SECRET } from "../src/vendored/internal/credentials.js";
import { MIN_LENGTH, notSecretAt, parseEnv, redact, respond, secretsFrom } from "../src/vendored/internal/redactSecrets.js";
import { tempDir } from "./helpers/tmp.js";

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "vendored", "hooks", "redact-secrets");

const TOKEN = "cf-dummy-0123456789abcdef";
const secrets = [{ name: "CLOUDFLARE_API_TOKEN", value: TOKEN }];
const noted = [];
const note = (text) => {
  noted.push(text);
  return "It was noted in the work log.";
};

// ------------------------------------------------------------- 実際に起きた式

// **今回の事故そのもの。** 変数名は `v` で、KEY・TOKEN・SECRET を含まない。
// コマンドの文字列を見る形では止まらなかった。出力を見れば拾える。
test("値の有無を確かめる誤った式で出た値を、置き換える", () => {
  const input = {
    tool_name: "Bash",
    tool_input: { command: 'v=$CLOUDFLARE_API_TOKEN; echo "${v:+set}${v:-EMPTY}"' },
    tool_response: { stdout: `set${TOKEN}`, stderr: "", interrupted: false, isImage: false, noOutputExpected: false },
  };
  const result = respond(input, secrets, note);

  assert.notEqual(result, null, "拾っていない");
  assert.equal(JSON.stringify(result).includes(TOKEN), false, "返すものに値が残っている");
  assert.equal(result.hookSpecificOutput.updatedToolOutput.stdout, "set[redacted: CLOUDFLARE_API_TOKEN]");
});

// ------------------------------------------------------------- 形を保つ

// **文字列を返すと、実行基盤は置き換えない**（実測）。tool_response と同じ形で返す。
test("出力の形を保ったまま、中の文字列だけを置き換える", () => {
  const response = { stdout: `A=${TOKEN}`, stderr: "", interrupted: false, isImage: false, noOutputExpected: false };
  const { output, found } = redact(response, secrets);
  assert.deepEqual(Object.keys(output), Object.keys(response), "形が変わっている");
  assert.equal(output.interrupted, false);
  assert.equal(output.stdout, "A=[redacted: CLOUDFLARE_API_TOKEN]");
  assert.deepEqual(found, ["CLOUDFLARE_API_TOKEN"]);
});

// **Read と Grep も同じく置き換わる**（実測）。中の深いところにある。
test("Read の出力の、入れ子の中も置き換える", () => {
  const response = { type: "text", file: { filePath: "/p/.env", content: `X=${TOKEN}\nY=${TOKEN}\n`, numLines: 2 } };
  const { output } = redact(response, secrets);
  assert.equal(output.file.content, "X=[redacted: CLOUDFLARE_API_TOKEN]\nY=[redacted: CLOUDFLARE_API_TOKEN]\n", "2つ目が残っている");
  assert.equal(output.file.numLines, 2);
});

test("当たらなければ何も返さない。出力に触れない", () => {
  const input = { tool_name: "Bash", tool_response: { stdout: "ok", stderr: "" } };
  assert.equal(respond(input, secrets, note), null);
});

// ------------------------------------------------------------- 何を秘密とみなすか

// **.env に無い鍵でも、形が決まっているものは拾う。**
test("形の決まったトークンは、.env に無くても置き換える", () => {
  const ghp = `ghp_${"a".repeat(36)}`;
  const cf = `cfut_${"b".repeat(30)}`;
  const { output, found } = redact({ stdout: `${ghp} ${cf} ${ghp}` }, []);
  assert.equal(output.stdout.includes("ghp_"), false, output.stdout);
  assert.equal(output.stdout.includes("cfut_"), false, output.stdout);
  assert.equal(found.length, 2, found.join(","));
});

// **秘密でないと分かっているものは置き換えない。** コミットの作者は git log のたびに出る。
// 置き換えると正しい出力が読めなくなり、知らせが多すぎて本物が読み流される。
test("秘密でないと分かっている名前と、短い値は突き合わせない", () => {
  const entries = parseEnv(
    [
      "GIT_USER_EMAIL=someone@example.invalid",
      "CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef",
      "AI_GATEWAY_ID=default",
      `CLOUDFLARE_API_TOKEN=${TOKEN}`,
    ].join("\n"),
  );
  const picked = secretsFrom(entries, NOT_SECRET).map((s) => s.name);
  assert.deepEqual(picked, ["CLOUDFLARE_API_TOKEN"]);
  assert.ok("default".length < MIN_LENGTH);
});

// **書かれていない名前は秘密として扱う。** 迷ったら隠す側に倒す。
test("表に無い名前は、秘密として扱う", () => {
  const picked = secretsFrom(parseEnv("SOMETHING_NEW=abcdefghijklmnop"), NOT_SECRET).map((s) => s.name);
  assert.deepEqual(picked, ["SOMETHING_NEW"]);
});

// **プロジェクトが秘密でないと書けること。** 書けないと、長い設定値のたびに知らせが飛ぶ。
test("app.credentials に secret: false と書いたものは、突き合わせない", () => {
  const root = tempDir("autodrive-redact-config-");
  writeFileSync(
    join(root, "autodrive.json"),
    JSON.stringify({
      version: 1,
      ports: {},
      app: { credentials: [{ name: "AI_GATEWAY_ID", why: "w", lost: "l", secret: false }, { name: "LLM_API_KEY", why: "w", lost: "l" }] },
    }),
  );
  const names = notSecretAt(root);
  assert.ok(names.has("AI_GATEWAY_ID"), "書いたのに秘密として扱っている");
  assert.equal(names.has("LLM_API_KEY"), false, "書いていないのに外している");
  assert.ok(names.has("GIT_USER_EMAIL"), "表の分を落としている");
});

// **長い値の一部が短い値だった場合も、残さない。**
test("長い値から先に置き換える", () => {
  const entries = [
    { name: "SHORT", value: "abcdefghijkl" },
    { name: "LONG", value: "abcdefghijklmnopqrstuvwxyz" },
  ];
  const { output } = redact({ stdout: "abcdefghijklmnopqrstuvwxyz" }, secretsFrom(entries, new Set()));
  assert.equal(output.stdout, "[redacted: LONG]");
});

test(".env の囲みの引用符と export を外して読む", () => {
  assert.deepEqual(parseEnv(`export A="x y"\nB='z'\n# c=1\nD=plain`), [
    { name: "A", value: "x y" },
    { name: "B", value: "z" },
    { name: "D", value: "plain" },
  ]);
});

// ------------------------------------------------------------- 知らせと記録

test("AI と人に知らせ、作業ログに残す。どこにも値を書かない", () => {
  noted.length = 0;
  const input = {
    tool_name: "Bash",
    tool_input: { command: `echo ${TOKEN}` },
    tool_response: { stdout: TOKEN, stderr: "" },
  };
  const result = respond(input, secrets, note);

  assert.match(result.systemMessage, /CLOUDFLARE_API_TOKEN/, "人に、どれが出たかを言っていない");
  assert.match(result.systemMessage, /work log/, "記録したかを人に言っていない");
  assert.match(result.hookSpecificOutput.additionalContext, /env check/, "安全な確かめ方を AI に示していない");
  assert.equal(noted.length, 1, "作業ログに残していない");
  // **コマンドに値を打ち込んでいた場合も、記録に写さない。**
  assert.equal(noted[0].includes(TOKEN), false, "作業ログに値を写している");
  assert.match(noted[0], /\[redacted: CLOUDFLARE_API_TOKEN\]/);
});

// ------------------------------------------------------------- 殻から通して

// **配られる形で動くこと。** .env を自分で読む（PostToolUse には CLAUDE_ENV_FILE が効かない）。
test("殻を通して、.env の値を置き換えた JSON を返す", () => {
  const project = tempDir("autodrive-redact-hook-");
  mkdirSync(join(project, ".autodrive"), { recursive: true });
  writeFileSync(join(project, ".env"), `CLOUDFLARE_API_TOKEN=${TOKEN}\n`);
  const input = { tool_name: "Bash", tool_input: { command: "cat .env" }, tool_response: { stdout: `CLOUDFLARE_API_TOKEN=${TOKEN}`, stderr: "" } };

  const out = execFileSync(HOOK, {
    input: JSON.stringify(input),
    encoding: "utf8",
    // **Tracker の鍵を渡さない。** 試験から作業ログへ書きに行かない。
    env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: project },
  });

  assert.equal(out.includes(TOKEN), false, "値が出ている");
  const result = JSON.parse(out);
  assert.equal(result.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.equal(result.hookSpecificOutput.updatedToolOutput.stdout, "CLOUDFLARE_API_TOKEN=[redacted: CLOUDFLARE_API_TOKEN]");
  assert.match(result.systemMessage, /could not be noted/, "記録できなかったことを言っていない");
});

test("壊れた入力でも、エージェントを止めない", () => {
  const out = execFileSync(HOOK, { input: "not json", encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(out, "");
});
