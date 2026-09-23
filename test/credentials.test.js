/**
 * 要る資格情報。
 *
 * **支度が使うものと、求めるものが一致すること。** 片方だけ増えると、動かない理由を
 * 人が自分で突き止めることになる。実際に `GH_TOKEN` が抜けていた（AUT-98）。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { credentialsFor, envExample } from "../src/vendored/internal/credentials.js";
import { NONE, defaults } from "../src/vendored/internal/config.js";
import { setup } from "../src/vendored/internal/setup.js";
import { useRecommended } from "../src/vendored/internal/ports/interview.js";
import { tempDir } from "./helpers/tmp.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project() {
  const root = tempDir("autodrive-cred-");
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
test("作者情報は、どの構成でも求める", () => {
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
    assert.ok(text.includes(c.why), `${c.name} の用途がテンプレートに無い`);
    assert.ok(text.includes(`失ったとき: ${c.lost}`), `${c.name} の失ったときがテンプレートに無い`);
  }
});

// **値を書かせない。** テンプレートに値が入ると、写した先で古い値が残る。
test("テンプレートに値を書かない", () => {
  const text = envExample(defaults());
  for (const line of text.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    assert.ok(line.endsWith("="), `テンプレートに値が入っている: ${line}`);
  }
});

// **構成から作られていることを、読む人に伝える。**
test("構成から作られていることを、テンプレートの中で伝える", () => {
  const text = envExample(defaults());
  assert.ok(text.includes("autodrive.json"), text.slice(0, 400));
  assert.ok(text.includes("update"), text.slice(0, 400));
});

// **置かれたテンプレートが、構成に従うこと。** 静的なテンプレートに戻すと、片方の構成でしか
// 合わなくなる。**両方向で確かめる。**
test("置かれたテンプレートが、構成に従う", () => {
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

// ---------------------------------------------------------------- 要る権限

// **足りないまま作ると、作業が進んでから止まる。足すたびにまた止まる。**
// 同じ種別の停止が2つのプロジェクトで起きた（AUT-108）。定義§6は
// 「繰り返し出る種別はスキル化・自動化の候補」としている。
test("トークンに要る権限を、先に全部言う", () => {
  const github = credentialsFor(defaults()).filter((c) => c.needs !== undefined);
  assert.ok(github.length > 0, "要る権限を言っている資格情報が1つも無い");

  const text = envExample(defaults());
  for (const c of github) {
    for (const n of c.needs) {
      assert.ok(text.includes(n.permission), `${c.name} に ${n.permission} が出ていない`);
      assert.ok(n.level.trim().length > 0, `${n.permission} に強さが無い`);
      assert.ok(n.why.trim().length > 0, `${n.permission} に理由が無い`);
      assert.ok(text.includes(n.why), `${n.permission} の理由がテンプレートに無い`);
    }
  }
});

// **実際に止まった権限を、必ず含むこと。** ここが抜けると、また同じ場所で止まる。
test("実際に止まった権限が、含まれている", () => {
  const token = credentialsFor(defaults()).find((c) => c.name === "GH_TOKEN");
  const has = (p) => token.needs.some((n) => n.permission === p);

  // このワークディレクトリで止まった: シークレットを登録できなかった
  assert.ok(has("Secrets"), "Secrets が抜けている");
  // 題材アプリ2で止まった: CI の結果と提出を読めなかった
  assert.ok(has("Actions"), "Actions が抜けている");
  assert.ok(has("Pull requests"), "Pull requests が抜けている");
});

// **要らない権限を並べないこと。** 並べると、別の停止を作る（AUT-110）。
//
// Checks は、autodrive-dev-kit が一度も呼ばない口の権限である。人が GitHub の一覧で探して
// 見つからず、そこで止まった。**求める理由が無い権限は、書いた側の思い込みである。**
test("使わない口の権限は、並べない", () => {
  for (const name of ["GH_TOKEN", "AUTODRIVE_CI_TOKEN"]) {
    const token = credentialsFor(defaults()).find((c) => c.name === name);
    const listed = token.needs.map((n) => n.permission);
    assert.equal(listed.includes("Checks"), false, `${name}: 叩かない口の権限を求めている`);
  }
});

// **どの権限にも、それを要求している口があること。**
//
// 推測で並べたものは、ここで書く手が止まる。**書けないなら、要らない。**
test("求める権限には、それを要求している口が書いてある", () => {
  for (const c of credentialsFor(defaults())) {
    for (const n of c.needs ?? []) {
      assert.ok(
        typeof n.via === "string" && n.via.trim() !== "",
        `${c.name} の ${n.permission} に、要求している口が書かれていない`,
      );
    }
  }
});

// **判定が実際に呼ぶものと、求める権限が食い違わないこと。**
test("判定が呼ぶ API に要る権限を、求めている", async () => {
  const { readFileSync } = await import("node:fs");
  const api = readFileSync(join(KIT, "src", "vendored", "internal", "repoApi.js"), "utf8");

  const token = credentialsFor(defaults()).find((c) => c.name === "AUTODRIVE_CI_TOKEN");
  const has = (p) => token.needs.some((n) => n.permission === p);

  // 統合されたかを読むなら Pull requests が要る。
  if (api.includes("/pulls")) assert.ok(has("Pull requests"), "pulls を読むのに権限を求めていない");
  // **保護設定の読取に Administration は要らない。** GitHub が要求するのは
  // Metadata: Read であり、選ばなくても必ず付く（AUT-110 で実測）。
  assert.equal(has("Administration"), false, "要らない管理権限を求めている");
});

// **求めていない理由が、テンプレートに出ること。**
//
// 書かないと、足りないと思った人が自分で足す。足せば、渡す必要のない権限が渡る。
test("置き場所の作成を求めていない理由が、テンプレートに出る", () => {
  const token = credentialsFor(defaults()).find((c) => c.name === "GH_TOKEN");
  assert.ok(token.note !== undefined, "理由が書かれていない");
  assert.ok(envExample(defaults()).includes(token.note), "理由がテンプレートに出ていない");
});

// **使わないポートの権限を並べない。** 要らないものを人に付けさせない。
test("使わないポートの権限は、並べない", () => {
  const config = defaults();
  config.ports.repo = NONE;
  const text = envExample(config);
  assert.equal(text.includes("Pull requests"), false, "使わない Repo の権限が出ている");
});

// ------------------------------------------------ アプリ自身の資格情報（AUT-112）

/** アプリ自身の資格情報を1つ持つ構成。 */
function withApp(credentials) {
  const config = defaults();
  config.app.credentials = credentials;
  return config;
}

const APP_KEY = {
  name: "ANTHROPIC_API_KEY",
  why: "モデルを叩く。無いと会話が成立しない",
  lost: "再発行する。古い値は使えなくなる",
};

test("アプリ自身の資格情報が、一覧に入る", () => {
  const found = credentialsFor(withApp([APP_KEY])).find((c) => c.name === APP_KEY.name);
  assert.ok(found !== undefined, "アプリの資格情報が落ちている");
  assert.equal(found.ofApp, true, "アプリのものだと分かる見出しが無い");
});

test("アプリ自身の資格情報が、テンプレートに出る", () => {
  const text = envExample(withApp([APP_KEY]));
  assert.ok(text.includes("ANTHROPIC_API_KEY="), "名前が出ていない");
  assert.ok(text.includes(APP_KEY.why), "何に使うのかが出ていない");
  assert.ok(text.includes(APP_KEY.lost), "失ったときの影響が出ていない");
});

// **どこまでが autodrive-dev-kit の都合で、どこからが作っているものの都合かを分ける。**
test("アプリ自身のものは、autodrive-dev-kit のものと混ざらない", () => {
  const text = envExample(withApp([APP_KEY]));
  assert.ok(text.includes("このプロジェクト自身のもの"), "見出しが無い");
  // 見出しより後に出ること。前に出ると、autodrive-dev-kit のものとして読まれる。
  assert.ok(
    text.indexOf("ANTHROPIC_API_KEY=") > text.indexOf("このプロジェクト自身のもの"),
    "見出しより前に出ている",
  );
  assert.ok(text.indexOf("GH_TOKEN=") < text.indexOf("このプロジェクト自身のもの"));
});

// **直接書くなと言うこと。** 言わないと書かれ、入れ替えで黙って消える。
test("テンプレートへ直接書いても消えることを、テンプレート自身が言う", () => {
  const text = envExample(withApp([APP_KEY]));
  assert.ok(text.includes("app.credentials"), "どこに書けばよいかが出ていない");
  assert.ok(text.includes("消える"), "直接書いたものが消えることを言っていない");
});

test("1つも無ければ、見出しも出さない", () => {
  assert.equal(envExample(defaults()).includes("このプロジェクト自身のもの"), false);
});

test("autodrive-dev-kit の資格情報と同じ名前は、二重に出さない", () => {
  const config = withApp([{ name: "GH_TOKEN", why: "重なった", lost: "重なった" }]);
  const names = credentialsFor(config).map((c) => c.name);
  assert.equal(names.filter((n) => n === "GH_TOKEN").length, 1, "同じ名前が2行出る");
});

// 2つの鍵が並んでいる理由を、テンプレートが持っていること。
//
// **書いていないと、片方で兼ねたくなる。** 同じ GitHub の鍵が2つ並び、なぜ分けて
// あるかがどこにも無かったため、実際に使い分けを問われた（AUT-139）。
//
// 兼ねると、**判定する側が判定対象を書き換えられる。** これは名前の問題ではなく、
// 定義§9の「AIがこれらを無効化できないこと」を誰が見るかの問題である。
test("読取専用の鍵に、書ける鍵で兼ねない理由が書いてある", () => {
  const ci = credentialsFor(defaults()).find((c) => c.name === "AUTODRIVE_CI_TOKEN");
  assert.notEqual(ci.note, undefined, "**兼ねない理由が無い。** 無いと片方で兼ねたくなる");
  assert.match(ci.note, /GH_TOKEN/, "どちらと兼ねてはいけないのかが書いていない");
  assert.match(ci.note, /判定/, "分けている理由（判定する側が書き換えられる）が書いていない");

  const text = envExample(defaults());
  assert.ok(text.includes(ci.note), "テンプレートに載っていない。人が読む場所に無ければ届かない");
});

// ---------------------------------------------- 同じ鍵を2つ並べない（AUT-235）

/** GitHub Issues を使う構成。 */
function usingGithubIssues() {
  const config = defaults();
  config.ports.tracker = "github-issues";
  return config;
}

// **同じ GitHub に対する書ける鍵を2つ求めない。** 実際に人が2つ用意する羽目になった。
test("GitHub Issues を使っても、作業単位のための鍵を別に求めない", () => {
  const names = credentialsFor(usingGithubIssues()).map((c) => c.name);

  assert.equal(
    names.includes("AUTODRIVE_TRACKER_TOKEN"),
    false,
    `同じ用途の鍵が2つ並んでいる: ${names.join(", ")}`,
  );
  assert.ok(names.includes("GH_TOKEN"), names.join(", "));
});

// **権限は消えないこと。** 名前で落とすと、後から来たほうの権限が静かに消える。
test("GH_TOKEN の権限に、作業単位の分が合流する", () => {
  const token = credentialsFor(usingGithubIssues()).find((c) => c.name === "GH_TOKEN");

  const permissions = (token?.needs ?? []).map((n) => `${n.permission}/${n.level}`);
  assert.ok(permissions.includes("Issues/Read and write"), permissions.join(", "));
  // 元から要るものが残っていること。
  assert.ok(permissions.includes("Contents/Read and write"), permissions.join(", "));
  assert.ok(permissions.includes("Pull requests/Read and write"), permissions.join(", "));
});

// **同じ権限を二重に並べない。** 読む人が、違うものかと考えることになる。
test("合流しても、同じ権限は1回しか出ない", () => {
  const token = credentialsFor(usingGithubIssues()).find((c) => c.name === "GH_TOKEN");
  const permissions = (token?.needs ?? []).map((n) => `${n.permission}/${n.level}`);

  assert.equal(new Set(permissions).size, permissions.length, permissions.join(", "));
});

// **両方の用途が読めること。** 片方しか書かないと、もう片方で使っていることが消える。
test("合流した鍵は、両方の用途を書いている", () => {
  const token = credentialsFor(usingGithubIssues()).find((c) => c.name === "GH_TOKEN");

  assert.ok(token?.why.includes("提出"), token?.why);
  assert.ok(token?.why.includes("作業単位"), token?.why);
  // **分けたい人への案内も残ること。**
  assert.ok(token?.note?.includes("AUTODRIVE_TRACKER_TOKEN"), token?.note);
});

// **判定用の分離は、変えない。** 兼ねると判定する側が判定対象を書き換えられる（定義§9）。
test("判定用の鍵は、いまも別である", () => {
  const names = credentialsFor(usingGithubIssues()).map((c) => c.name);
  assert.ok(names.includes("AUTODRIVE_CI_TOKEN"), names.join(", "));

  const ci = credentialsFor(usingGithubIssues()).find((c) => c.name === "AUTODRIVE_CI_TOKEN");
  assert.ok(ci?.note?.includes("GH_TOKEN で兼ねないこと"), ci?.note);
  // **Issues の権限は、こちらへ付かない。** 読むだけの鍵である。
  const permissions = (ci?.needs ?? []).map((n) => n.permission);
  assert.equal(permissions.includes("Issues"), false, permissions.join(", "));
});

// **Linear を使う構成は、変わらないこと。**
test("Linear を使う構成に、Issues の権限を足さない", () => {
  const token = credentialsFor(defaults()).find((c) => c.name === "GH_TOKEN");
  const permissions = (token?.needs ?? []).map((n) => n.permission);

  assert.equal(permissions.includes("Issues"), false, `要らない権限を求めている: ${permissions.join(", ")}`);
});
