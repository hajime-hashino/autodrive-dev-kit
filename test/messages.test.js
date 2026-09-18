/**
 * 人に見せる文。
 *
 * **片方の言語だけに足すと、もう片方で抜ける。** ここが一番起きやすい壊れ方で
 * あり、書いた本人には見えない（自分の言語では出るため）。
 *
 * **規約と定義は、ここに入れない。** 毎日書き換わるため訳が古くなり、AIが従う
 * 規約と人が読む規約が食い違う。**一言語で持つより悪い**（AUT-102）。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { LANGUAGES, keysOf, say } from "../src/vendored/internal/messages.js";
import { LANGUAGE_QUESTION, questionsFor, setup } from "../src/vendored/internal/setup.js";
import { readConfig } from "../src/vendored/internal/config.js";
import { tempDir } from "./helpers/tmp.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project() {
  const root = tempDir("autodrive-lang-");
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

/** 選んだ言語だけを答える。他は既定に任せる。 */
const speaking = (language) => ({
  answer: (q) => (q === LANGUAGE_QUESTION ? language : null),
});

// ---------------------------------------------------------------- 揃っているか

// **片方だけに足すと、もう片方で抜ける。** 書いた本人には見えない。
test("すべての言語が、同じ文を持っている", () => {
  const base = keysOf(LANGUAGES[0]);
  for (const language of LANGUAGES) {
    const here = keysOf(language);
    const missing = base.filter((k) => !here.includes(k));
    const extra = here.filter((k) => !base.includes(k));

    assert.deepEqual(missing, [], `${language} に無い: ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `${language} にだけある: ${extra.join(", ")}`);
  }
  assert.ok(base.length > 20, `文が少なすぎる: ${base.length}`);
});

// **空の文を置かない。** 出しても何も伝わらない。
test("空の文を持たない", () => {
  for (const language of LANGUAGES) {
    for (const key of keysOf(language)) {
      assert.ok(say(language, key).trim().length > 0, `${language} の ${key} が空`);
    }
  }
});

// **無い鍵を空白で通さない。** 何が抜けたのか読む側から分からなくなる。
test("知らない鍵は、抜けが見える形で返す", () => {
  const said = say("ja", "そんな鍵は無い");
  assert.ok(said.includes("そんな鍵は無い"), said);
  assert.notEqual(said.trim(), "");
});

// 差し込みが効くこと。**片方の言語だけ効く、が起きないこと。**
test("差し込みが、どの言語でも効く", () => {
  for (const language of LANGUAGES) {
    const said = say(language, "headline.init", { version: "9.9.9" });
    assert.ok(said.includes("9.9.9"), `${language}: ${said}`);
    assert.equal(said.includes("{version}"), false, `${language} で差し込めていない`);
  }
});

// ---------------------------------------------------------------- 聞き方

// **言語を先に聞く。** 決まってからでないと、以降の問いを何語で出すか決まらない。
test("言語の問いは、どの言語でも読める形で出す", () => {
  const text = `${LANGUAGE_QUESTION.ask} ${LANGUAGE_QUESTION.why}`;
  for (const language of LANGUAGES) {
    assert.ok(
      text.includes(say(language, "ask.language")),
      `${language} の人が読めない: ${LANGUAGE_QUESTION.ask}`,
    );
  }
  // 選択肢は、それぞれの言語で書く。
  assert.deepEqual(
    LANGUAGE_QUESTION.choices.map((c) => c.value),
    [...LANGUAGES],
  );
});

// **会話は翻訳の対象ではない。** そこを誤解させない。
test("設定の文だけであることを、その場で伝える", () => {
  for (const language of LANGUAGES) {
    const why = say(language, "ask.language.why");
    assert.ok(why.length > 0);
  }
  assert.ok(LANGUAGE_QUESTION.why.includes("あなたの言語"), LANGUAGE_QUESTION.why);
  assert.ok(LANGUAGE_QUESTION.why.includes("your language"), LANGUAGE_QUESTION.why);
});

// **問いが自分の言語を持つ。** 出す側が決めると、言語を選ぶ前の問いを出せない。
test("問いは、自分の言語を持つ", () => {
  for (const language of LANGUAGES) {
    for (const q of questionsFor(language)) {
      assert.equal(q.language, language, `${q.ask} が言語を持っていない`);
      assert.equal(q.ask, say(language, `ask.${q.port}`), `${language} で出していない`);
    }
  }
});

// ---------------------------------------------------------------- 通しで

test("選んだ言語が、構成に残る", () => {
  for (const language of LANGUAGES) {
    const root = project();
    setup("init", root, KIT, speaking(language), true);
    assert.equal(readConfig(root).config?.language, language);
  }
});

// **選んだ言語で、全部が出ること。** 一部だけ残ると、そこが目立って読みにくい。
test("選んだ言語で、案内も構成も出る", () => {
  const en = setup("init", project(), KIT, speaking("en"), true);
  const said = [...en.decisions, ...en.todo].join("\n");

  assert.equal(
    /[ぁ-んァ-ヶ一-龠]/.test(said),
    false,
    `英語を選んだのに日本語が混ざっている:\n${said}`,
  );

  const ja = setup("init", project(), KIT, speaking("ja"), true);
  assert.ok(/[ぁ-んァ-ヶ一-龠]/.test([...ja.decisions, ...ja.todo].join("\n")));
});

// **入れ替えでも、記録された言語で出る。** 聞き直さない。
test("入れ替えは、記録された言語で出す", () => {
  const root = project();
  setup("init", root, KIT, speaking("en"), true);

  const again = setup("update", root, KIT, speaking("ja"), true);
  assert.equal(
    /[ぁ-んァ-ヶ一-龠]/.test(again.decisions.join("\n")),
    false,
    `記録された言語を無視している:\n${again.decisions.join("\n")}`,
  );
});

// **規約と定義は訳さない。** ここに入れると、訳が古くなって食い違う。
test("規約や定義の文を、表に持ち込まない", () => {
  const rules = readFileSync(join(KIT, "src", "templates", "autodrive.md"), "utf8");
  for (const language of LANGUAGES) {
    for (const key of keysOf(language)) {
      const said = say(language, key);
      if (said.length < 30) continue;
      assert.equal(
        rules.includes(said),
        false,
        `配る規約の文が、訳す表に入っている: ${key}`,
      );
    }
  }
  assert.ok(existsSync(join(KIT, "src", "templates", "autodrive.md")));
});
