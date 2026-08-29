/**
 * 要る資格情報。
 *
 * **支度が使うものと、求めるものが一致すること。** 片方だけ増えると、動かない理由を
 * 人が自分で突き止めることになる。実際に `GH_TOKEN` が抜けていた（AUT-98）。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { credentialsFor, envExample } from "../src/credentials.js";
import { NONE, defaults } from "../src/config.js";
import { setup } from "../src/setup.js";
import { useRecommended } from "../src/ports/interview.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project() {
  const root = mkdtempSync(join(tmpdir(), "autodrive-cred-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

const names = (config) => credentialsFor(config).map((c) => c.name);

// **これが今回の穴である。** 支度が git の資格情報ヘルパに使うのに、求めていなかった。
test("push に要るものを、求めている", () => {
  assert.ok(names(defaults()).includes("GH_TOKEN"), names(defaults()).join(", "));
});

// **支度が使う変数と、求める変数が一致すること。** 片方だけ増えたときに気づく。
test("支度が使う資格情報が、すべて求められている", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  const post = readFileSync(join(root, ".devcontainer", "post-create.sh"), "utf8");
  const example = readFileSync(join(root, ".env.example"), "utf8");

  // 支度が読む変数のうち、そのファイルの中で作っていないもの。
  // **字下げされた代入も拾う。** 拾い漏らすと、その場で作った変数を
  // 資格情報として求めることになる。
  const assigned = new Set([...post.matchAll(/^\s*([A-Z_]+)=/gm)].map((m) => m[1]));
  const shell = new Set(["HOME", "PWD", "PATH", "CLAUDE_CONFIG_DIR"]);

  const used = [...post.matchAll(/\$\{?([A-Z_]{3,})\b/g)]
    .map((m) => m[1])
    .filter((n) => !assigned.has(n) && !shell.has(n));

  assert.ok(used.length > 0, "支度が使う変数を拾えていない");
  for (const name of new Set(used)) {
    assert.ok(example.includes(`${name}=`), `支度が使う ${name} を .env.example が求めていない`);
  }
});

// **使わないポートのものを求めない。** 要らないものを人に発行させない。
test("使わないポートの資格情報は、求めない", () => {
  const config = defaults();
  config.ports.tracker = NONE;
  config.ports.preview = NONE;

  const got = names(config);
  assert.equal(got.includes("LINEAR_API_KEY"), false, "使わない作業単位の資格情報を求めている");
  assert.equal(got.includes("CLOUDFLARE_API_TOKEN"), false, "使わない配布先の資格情報を求めている");
  assert.ok(got.includes("GH_TOKEN"), "使うものが落ちている");
});

test("使うポートの資格情報は、求める", () => {
  const config = defaults();
  config.ports.preview = "cloudflare-workers";
  const got = names(config);
  assert.ok(got.includes("CLOUDFLARE_API_TOKEN"));
  assert.ok(got.includes("CLOUDFLARE_ACCOUNT_ID"));
});

// **どの構成でも要るものがある。** 無いと commit そのものが通らない。
test("身元は、どの構成でも求める", () => {
  const bare = defaults();
  for (const port of Object.keys(bare.ports)) bare.ports[port] = NONE;

  const got = names(bare);
  assert.ok(got.includes("GIT_USER_NAME"));
  assert.ok(got.includes("GIT_USER_EMAIL"));
});

test("同じものを二重に求めない", () => {
  const shared = defaults();
  shared.ports.tracker = "github";
  const got = names(shared);
  assert.equal(new Set(got).size, got.length, got.join(", "));
});

// **何に使うかと、失ったらどうなるかを併記する。** 名前だけでは、何を取りに
// 行けばよいかも、扱いの重さも判断できない。
test("それぞれ、何に使うかと失ったときが書いてある", () => {
  const text = envExample(defaults());
  for (const c of credentialsFor(defaults())) {
    assert.ok(c.why.trim().length > 0, `${c.name} に用途が無い`);
    assert.ok(c.lost.trim().length > 0, `${c.name} に失ったときが無い`);
    assert.ok(text.includes(c.why), `${c.name} の用途が雛形に無い`);
    assert.ok(text.includes(`失ったとき: ${c.lost}`), `${c.name} の失ったときが雛形に無い`);
  }
});

// **値を書かせない。** 雛形に値が入ると、写した先で古い値が残る。
test("雛形に値を書かない", () => {
  const text = envExample(defaults());
  for (const line of text.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    assert.ok(line.endsWith("="), `雛形に値が入っている: ${line}`);
  }
});

// **構成から作られていることを、読む人に伝える。**
test("構成から作られていることを、雛形の中で伝える", () => {
  const text = envExample(defaults());
  assert.ok(text.includes("autodrive.json"), text.slice(0, 400));
  assert.ok(text.includes("update"), text.slice(0, 400));
});

// **置かれた雛形が、構成に従うこと。** 静的な雛形に戻すと、片方の構成でしか
// 合わなくなる。**両方向で確かめる。**
test("置かれた雛形が、構成に従う", () => {
  const without = project();
  setup("init", without, KIT, { answer: (q) => (q.ask.includes("動くもの") ? NONE : null) });
  const a = readFileSync(join(without, ".env.example"), "utf8");
  assert.equal(a.includes("CLOUDFLARE_API_TOKEN"), false, "使わない配布先を求めている");
  assert.ok(a.includes("GH_TOKEN"));

  const with_ = project();
  setup("init", with_, KIT, { answer: (q) => (q.ask.includes("動くもの") ? "cloudflare-workers" : null) });
  const b = readFileSync(join(with_, ".env.example"), "utf8");
  assert.ok(b.includes("CLOUDFLARE_API_TOKEN"), "使う配布先の資格情報を求めていない");

  // **構成から作られていることが、置かれた先でも分かること。**
  assert.ok(b.includes("autodrive.json"), b.slice(0, 400));
  assert.ok(existsSync(join(with_, ".env.example")));
});
