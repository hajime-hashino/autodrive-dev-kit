/**
 * `init` / `apply` / `update`。
 *
 * **端末を要求しない。** ヒアリングはポートになっており、ここでは答えを差し込む。
 * 端末が要るとテストが動かせず、判定されないものはいずれ壊れる。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { QUESTIONS, setup } from "../src/setup.js";

import { CONFIG_FILE, NONE, PORT_NAMES, UNKNOWN, defaults, infer, readConfig } from "../src/config.js";
import {
  chosen,
  howToHandle,
  openTerminal,
  render,
  terminalInterview,
} from "../src/adapters/interviewTerminal.js";
import { useRecommended } from "../src/ports/interview.js";
import { tempDir } from "./helpers/tmp.js";


/** 聞かれた問い。どのポートについてかも見る。 */


const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project() {
  const root = tempDir("autodrive-setup-");
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

/** 決まった答えを返す。**問いも記録する。** 何を聞かれたかが判定の対象になる。 */
function answering(answers) {
  const asked = [];
  return {
    asked,
    answer(q) {
      asked.push(q);
      return answers[q.ask] ?? null;
    },
  };
}

/**
 * **中にいるかを必ず差し込む。** 差し込まないと、実行する場所で案内が変わり、
 * 手元では通って CI で落ちる。実際にそうなった（AUT-100）。
 */
const run = (mode , root , port = useRecommended, inside = true) =>
  setup(mode, root, KIT, port, inside);

const configOf = (root) => readConfig(root).config;

// ---------------------------------------------------------------- 前提の確認

// **3つの違いを人に覚えさせない。** 打つものを間違えたら、どれを打てばよいかを出す。
test("入れ替えを、土台の無い場所で打ったら、何を打てばよいかを出す", () => {
  const r = run("update", project());
  assert.equal(r.code, 1);
  assert.ok(r.message?.includes("init"), r.message ?? "");
  assert.ok(r.message?.includes("apply"), r.message ?? "");
  assert.equal(r.placed.length, 0, "止まるべきところで置いている");
});

// **決めた内容を、黙って上書きしない。**
for (const mode of ["init", "apply"] ) {
  test(`${mode} を、既に構成のある場所で打ったら止まる`, () => {
    const root = project();
    run("init", root);
    const before = readFileSync(join(root, CONFIG_FILE), "utf8");

    const r = run(mode, root);
    assert.equal(r.code, 1);
    assert.ok(r.message?.includes("update"), r.message ?? "");
    assert.equal(readFileSync(join(root, CONFIG_FILE), "utf8"), before, "構成が変わっている");
  });
}

// ---------------------------------------------------------------- init

test("init は聞いて、答えのとおりに構成を残す", () => {
  const root = project();
  const port = answering({ [QUESTIONS[0].ask]: NONE });

  const r = run("init", root, port);
  assert.equal(r.code, 0);
  assert.equal(configOf(root)?.ports[QUESTIONS[0].port], NONE);
  assert.ok(port.asked.length > 0, "何も聞いていない");

  // **選んだことと、推奨のまま進んだことを見分けられる。** 混ぜると、選んだ
  // 覚えのないものが選んだように見える。
  const chosenLine = r.decisions.find((d) => d.startsWith(`${QUESTIONS[0].port}: `));
  assert.ok(chosenLine?.includes("選んだもの"), chosenLine ?? "");
  const notChosen = r.decisions.find((d) => d.startsWith(`${QUESTIONS[1].port}: `));
  assert.equal(notChosen?.includes("選んだもの"), false, notChosen ?? "");
});

// **選択肢が1つしか無いものは聞かない。** 答えを持たない問いに人の時間を使わせない。
test("選べないものは聞かない。ただし記録はする", () => {
  const root = project();
  const port = answering({});
  run("init", root, port);

  const asked = new Set(port.asked.map((q) => q.ask));
  for (const q of port.asked) {
    assert.ok(q.choices.length > 1, `選択肢が1つなのに聞いている: ${q.ask}`);
  }
  assert.ok(asked.size > 0);

  // 聞かなかったものも、構成には全部載る。**空欄にしない。**
  const config = configOf(root);
  for (const p of PORT_NAMES) {
    assert.ok((config?.ports[p] ?? "").length > 0, `${p} が空`);
  }
});

// **聞かれなかった項目が決まっていることに、気づけること。** 出さないと、
// 選ばれていないものが選ばれたように見える。
test("聞かなかったものも、何になったかを出す", () => {
  const r = run("init", project(), answering({}));
  const shown = r.decisions.join("\n");
  for (const p of PORT_NAMES) {
    assert.ok(shown.includes(`${p}: `), `${p} が構成の出力に無い`);
  }
  assert.ok(shown.includes("選択肢が1つ"), shown);
});

// **黙って既定に倒れない。** 決めていないものが決めたものに見える。
test("聞けなかったときは、推奨で進めたことを出す", () => {
  const r = run("init", project(), useRecommended);
  assert.ok(
    r.decisions.some((d) => d.includes("推奨のまま")),
    r.decisions.join(" / "),
  );
});

// 画面の有無は、何を作るかを聞く段で決まる（AUT-80）。土台を置く時点では誰も知らない。
test("画面の有無は init では決めない", () => {
  const root = project();
  run("init", root);
  assert.equal(configOf(root)?.app.screen, UNKNOWN);
  for (const q of QUESTIONS) assert.notEqual(q.port , "app");
});

// ---------------------------------------------------------------- apply

test("apply は既にあるものを見て、それを推奨にする", () => {
  const root = project();
  writeFileSync(join(root, "wrangler.jsonc"), "{}", "utf8");
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });

  const port = answering({});
  const r = run("apply", root, port);

  const preview = port.asked.find((q) => q.ask === QUESTIONS[0].ask);
  assert.equal(preview?.recommended, "cloudflare-workers", "見て分かったことを推奨にしていない");
  assert.equal(configOf(root)?.ports.preview, "cloudflare-workers");

  // **見て分かったことが、静的な推奨を上書きすること。** ここが効いていないと、
  // 既にあるものを人に否定させることになる。隔離は既定では推奨するが、
  // この場所には作業場が置かれていない。
  const sandbox = port.asked.find((q) => q.port === "sandbox");
  assert.equal(sandbox?.recommended, NONE, "既定の推奨が、見て分かったことを押しのけている");
  assert.notEqual(sandbox?.recommended, QUESTIONS[1].recommended, "静的な推奨と区別がついていない");
  assert.equal(configOf(root)?.ports.sandbox, NONE);

  // **根拠を出す。** 何を見てそう言っているかが分からないと、確かめようがない。
  assert.ok(r.decisions.some((d) => d.includes("wrangler.jsonc")), r.decisions.join(" / "));

  // **一行につき一つの理由。** 同じポートが2回出ると、どちらが本当か読む側が
  // 決めることになる。
  for (const p of PORT_NAMES) {
    const hits = r.decisions.filter((d) => d.startsWith(`${p}: `));
    assert.equal(hits.length, 1, `${p} が ${hits.length} 行ある: ${hits.join(" / ")}`);
  }

  // 聞かなかったポートも、見て分かったなら根拠が付く。**「選択肢が1つ」で
  // 済ませると、推測したことが消える。**
  const runner = r.decisions.find((d) => d.startsWith("runner: "));
  assert.ok(runner?.includes(".github/workflows"), runner ?? "");
});

// **推測できていないものに、既定を推奨として出さない。** 構成の既定値は
// 「聞かないポートの初期値」であって、推奨ではない。
test("見て分からなかったものは、問いの推奨のまま", () => {
  const root = project();
  const port = answering({});
  run("apply", root, port);

  const preview = port.asked.find((q) => q.ask === QUESTIONS[0].ask);
  assert.equal(preview?.recommended, QUESTIONS[0].recommended);
});

test("推測は、見て分かったものだけに根拠を付ける", () => {
  const root = project();
  mkdirSync(join(root, ".devcontainer"), { recursive: true });
  const { config, because } = infer(root, "git@github.com:x/y.git");

  assert.equal(config.ports.sandbox, "devcontainer");
  assert.ok(because.sandbox?.includes(".devcontainer"), JSON.stringify(because));
  assert.ok(because.repo?.includes("github.com"), JSON.stringify(because));
  // 見ていないものに根拠は付かない。
  assert.equal(because.preview, undefined);
});

test("遠隔が無くても、推測は落ちない", () => {
  const { because } = infer(project(), null);
  assert.equal(because.repo, undefined);
});

// ---------------------------------------------------------------- update

// **決めた内容はプロジェクトのものである。** 入れ替えで触らない。
test("入れ替えは、構成を読むだけで書き換えない", () => {
  const root = project();
  run("init", root, answering({ [QUESTIONS[0].ask]: "cloudflare-workers" }));

  writeFileSync(
    join(root, CONFIG_FILE),
    JSON.stringify({ version: 1, ports: { preview: "cloudflare-workers" }, app: { screen: "yes" }, 将来の項目: 1 }),
    "utf8",
  );
  const before = readFileSync(join(root, CONFIG_FILE), "utf8");

  const r = run("update", root, answering({}));
  assert.equal(r.code, 0);
  assert.equal(readFileSync(join(root, CONFIG_FILE), "utf8"), before, "構成を書き換えている");
  assert.ok(existsSync(join(root, "autodrive", "invariants")), "道具を入れ替えていない");
});

// **済んでいることを頼まない。** 毎回同じ一覧を出すと読まれなくなり、本当に
// 要るものが出たときにも読まれない。
test("済んでいる手続きを、もう一度頼まない", () => {
  const root = project();
  const first = run("init", root);

  // **頼んでいる項目そのものを見る。** 部分一致で見ると、別の項目に同じ語が
  // 出てきたときに当たる。実際に「.env を作ってから開き直す」に当たった。
  const asksForEnv = (r) => r.todo.some((t) => t.startsWith(".env を作り"));
  assert.equal(asksForEnv(first), true, first.todo.join(" / "));

  writeFileSync(join(root, ".env"), "LINEAR_API_KEY=x\n", "utf8");
  const again = run("update", root);
  assert.equal(asksForEnv(again), false, again.todo.join(" / "));
  // 入れ替えは、既に動いているプロジェクトに打つ。始め方の案内も要らない。
  assert.equal(again.todo.some((t) => t.includes("はじめる")), false, again.todo.join(" / "));
});

// **実行する場所で案内が変わってよいのは、1つだけである。** 他が変われば、
// 手元では通って CI で落ちる。実際にそうなった（AUT-100）。
test("実行する場所で変わるのは、開き直せと言うかどうかだけ", () => {
  const outside = run("init", project(), useRecommended, false).todo;
  const inside = run("init", project(), useRecommended, true).todo;

  const only = outside.filter((t) => !inside.includes(t));
  assert.equal(only.length, 1, `場所で変わる項目が多すぎる:\n${only.join("\n")}`);
  assert.ok(only[0].includes("Reopen in Container"), only[0]);
  assert.deepEqual(inside.filter((t) => !outside.includes(t)), [], "中にいるときだけ出る項目がある");
});

test("入れ替えは何も聞かない", () => {
  const root = project();
  run("init", root);
  const port = answering({});
  run("update", root, port);
  assert.equal(port.asked.length, 0, `聞いている: ${port.asked.map((q) => q.ask).join(" / ")}`);
});

// **壊れた構成を既定で埋めない。** 決めた内容が黙って別のものに入れ替わる。
test("読めない構成では、置かずに止まる", () => {
  const root = project();
  run("init", root);
  writeFileSync(join(root, CONFIG_FILE), "{ これは JSON ではない", "utf8");

  const r = run("update", root);
  assert.equal(r.code, 1);
  assert.ok(r.message?.includes(CONFIG_FILE), r.message ?? "");
  assert.equal(r.placed.length, 0);
});

// **この版が知らない項目を捨てない。** 新しい版が足したものを、古い版が読んで
// 書き戻すと消える。
test("知らない項目を落とさない", () => {
  const root = project();
  writeFileSync(
    join(root, CONFIG_FILE),
    JSON.stringify({ version: 1, ports: { tracker: "linear", 将来のポート: "なにか" }, app: { screen: "yes" } }),
    "utf8",
  );
  const config = readConfig(root).config;
  assert.equal(config.ports["将来のポート"], "なにか");
  assert.equal(config.ports.repo, "github", "欠けているものを補っていない");
});

test("版が違えば読まない", () => {
  const root = project();
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ version: 2, ports: {} }), "utf8");
  assert.ok(readConfig(root).error?.includes("version"), readConfig(root).error ?? "");
});

// ---------------------------------------------------------------- 端末

// **読めない答えを推奨として飲み込まない。** 選んだつもりの人が、選ばれなかった
// ことに気づけない。
test("選択肢に無い答えは、聞き直す", () => {
  const q = QUESTIONS[0];
  assert.deepEqual(chosen(q, "9"), { value: null, retry: true });
  assert.deepEqual(chosen(q, "はい"), { value: null, retry: true });
  assert.deepEqual(chosen(q, "1.5"), { value: null, retry: true });
  assert.deepEqual(chosen(q, "0"), { value: null, retry: true });
});

test("そのまま Enter は推奨を選んだことになる", () => {
  const q = QUESTIONS[0];
  assert.deepEqual(chosen(q, ""), { value: q.recommended, retry: false });
  assert.deepEqual(chosen(q, "  "), { value: q.recommended, retry: false });
});

test("番号は、そのまま並び順に対応する", () => {
  const q = QUESTIONS[0];
  q.choices.forEach((c, i) => assert.equal(chosen(q, String(i + 1)).value, c.value));
});

// 終端（端末が閉じた、パイプが終わった）は「答えられない」であって推奨ではない。
test("答えが来なければ、答えられないことにする", () => {
  assert.deepEqual(chosen(QUESTIONS[0], null), { value: null, retry: false });
});

// **専門語で聞かない。** 前提知識を要求する問いかけは、人のスキルレベルによらず
// 開発できるという前提を損なう。問いには理由が付き、推奨が見えること。
test("問いは、理由と推奨を添えて出す", () => {
  for (const q of QUESTIONS) {
    const out = render(q);
    assert.ok(out.includes(q.why), `理由が出ていない: ${q.ask}`);
    assert.ok(out.includes("← 推奨"), `推奨が見えない: ${q.ask}`);
    assert.ok(q.why.length > 0, `理由が空: ${q.ask}`);
    assert.ok(q.choices.some((c) => c.value === q.recommended), `推奨が選択肢に無い: ${q.ask}`);
  }
});

// ---------------------------------------------------------------- 入口

test("3つとも入口から打てる", () => {
  const out = execFileSync(join(KIT, "bin", "autodrive-dev-kit"), ["--help"], { encoding: "utf8" });
  for (const m of ["init", "apply", "update"]) {
    assert.ok(out.includes(`autodrive-dev-kit ${m}`), `${m} が案内に無い`);
  }
});

// ---------------------------------------------------------------- 端末で聞く

// **聞けないなら、質問を出さない。** 出しておいて待たないと、画面には聞いている
// ように見えて、答えを受け取っていない状態になる。実際にそうなった（AUT-101）。
test("端末を開けないなら、質問を出さない", () => {
  const written = [];
  const port = terminalInterview(
    () => null,
    () => "1",
    (s) => written.push(s),
  );

  assert.equal(port.answer(QUESTIONS[0]), null, "聞けないのに答えを返している");
  assert.deepEqual(written, [], `聞けないのに質問を出している:\n${written.join("")}`);
});

test("端末を開けるなら、質問を出して待つ", () => {
  const written = [];
  const port = terminalInterview(
    () => 9,
    () => "2",
    (s) => written.push(s),
    () => {},
  );

  assert.equal(port.answer(QUESTIONS[0]), QUESTIONS[0].choices[1].value);
  assert.ok(written.join("").includes(QUESTIONS[0].ask), "質問を出していない");
});

// **開けた端末は閉じる。** 開いたままにすると、次に開けなくなる余地ができる。
test("聞き終えたら、端末を閉じる", () => {
  const opened = [];
  const closed = [];
  const port = terminalInterview(
    () => {
      opened.push(9);
      return 9;
    },
    () => "1",
    () => {},
    (fd) => closed.push(fd),
  );
  port.answer(QUESTIONS[0]);
  port.answer(QUESTIONS[1]);

  assert.equal(opened.length, 2, "開き直していない");
  assert.deepEqual(closed, opened, "開いたものを閉じていない");
});

// **すべての失敗を終端として扱わない。** EAGAIN は「まだ入力が無い」であって、
// 「もう来ない」ではない。待てばよいものを諦めると、聞いたつもりで聞けていない。
test("まだ入力が無いだけなら、諦めない", () => {
  assert.equal(howToHandle({ code: "EAGAIN" }), "また試す");
  assert.equal(howToHandle({ code: "EWOULDBLOCK" }), "また試す");

  for (const code of ["EOF", "EBADF", "EIO", undefined]) {
    assert.equal(howToHandle({ code }), "終わり", `${code} を待ち続けている`);
  }
});

// **標準入力（fd 0）をそのまま読まない。** 非ブロッキングで開かれていることが
// あり、macOS では EAGAIN が返る。**待てばよいものを諦めていた**（AUT-101）。
//
// 端末があるかは実行する場所で変わるため、**開けたかどうかは見ない。**
// 開けた場合に、それが標準入力でないことだけを見る。
test("端末は、標準入力とは別に開く", async () => {
  const { closeSync } = await import("node:fs");
  const fd = openTerminal();

  if (fd === null) return; // 端末が無い場所。ここでは何も言えない
  assert.ok(fd > 2, `標準入力や標準出力をそのまま返している: fd=${fd}`);
  closeSync(fd);
});

// -------------------------------------- アプリ自身の資格情報（AUT-112）

/** 構成を直接書く。**AIが書く形をそのまま試す。** */
function writeRawConfig(root, app) {
  writeFileSync(
    join(root, CONFIG_FILE),
    JSON.stringify({ version: 1, language: "ja", ports: defaults().ports, app }, null, 2),
    "utf8",
  );
}

const GOOD = { name: "ANTHROPIC_API_KEY", why: "モデルを叩く", lost: "再発行する" };

test("入れ替えても、アプリ自身の資格情報は残る", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", credentials: [GOOD] });

  const result = run("update", root);

  assert.equal(result.message, null, result.message ?? "");
  assert.deepEqual(configOf(root).app.credentials, [GOOD], "入れ替えで消えている");
  // **雛形にも出ること。** 構成に残っていても、出なければ役目を果たさない。
  assert.ok(
    readFileSync(join(root, ".env.example"), "utf8").includes("ANTHROPIC_API_KEY="),
    "雛形に出ていない",
  );
});

// **欠けていたら、既定で埋めずに止まる。** 名前だけの一覧は役に立たない。
test("何に使うのかが無ければ、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", credentials: [{ name: "X_KEY", lost: "再発行" }] });

  const result = run("update", root);

  assert.equal(result.code, 1);
  assert.ok(result.message.includes("why"), result.message);
  assert.ok(result.message.includes("X_KEY"), `どれが悪いのかを出していない: ${result.message}`);
});

test("失ったときの影響が無ければ、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", credentials: [{ name: "X_KEY", why: "何か" }] });

  const result = run("update", root);

  assert.equal(result.code, 1);
  assert.ok(result.message.includes("lost"), result.message);
});

test("環境変数にならない名前は、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", credentials: [{ name: "x key", why: "あ", lost: "い" }] });

  assert.equal(run("update", root).code, 1);
});

test("配列でなければ、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", credentials: { name: "X_KEY" } });

  assert.equal(run("update", root).code, 1);
});

// **無いことは、壊れていることではない。** 大半のプロジェクトは持たない。
test("持っていなくても、そのまま通る", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes" });

  assert.equal(run("update", root).message, null);
  assert.deepEqual(configOf(root).app.credentials, []);
});

// -------------------------------------- アプリ自身の宛先（AUT-115）

const DEST = { host: "example.workers.dev", why: "配布先の疎通確認" };

// **これが本体。** 手で足したものが消えるのが元の欠陥であり、構成に書けば残ること。
test("入れ替えても、アプリ自身の宛先は残る", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", destinations: [DEST] });

  const result = run("update", root);

  assert.equal(result.message, null, result.message ?? "");
  assert.deepEqual(configOf(root).app.destinations, [DEST], "入れ替えで消えている");
  assert.ok(
    readFileSync(join(root, ".devcontainer", "allowed-domains.txt"), "utf8").includes(DEST.host),
    "許可一覧に出ていない",
  );
});

test("なぜ要るのかが無ければ、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", destinations: [{ host: "example.com" }] });

  const result = run("update", root);

  assert.equal(result.code, 1);
  assert.ok(result.message.includes("why"), result.message);
  assert.ok(result.message.includes("example.com"), `どれが悪いのかを出していない: ${result.message}`);
});

// **書ければ通ると思わせない。** 規則は名前解決した IP に対して置かれる。
test("ワイルドカードは、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", destinations: [{ host: "*.workers.dev", why: "配布先" }] });

  const result = run("update", root);

  assert.equal(result.code, 1);
  assert.ok(result.message.includes("ワイルドカード"), `理由を出していない: ${result.message}`);
});

test("宛先の形になっていなければ、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", destinations: [{ host: "ここ", why: "あ" }] });

  assert.equal(run("update", root).code, 1);
});

test("宛先を持っていなくても、そのまま通る", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes" });

  assert.equal(run("update", root).message, null);
  assert.deepEqual(configOf(root).app.destinations, []);
});

// -------------------------------------- 作業場に足す道具（AUT-132）

const FEAT = { id: "ghcr.io/devcontainers/features/docker-in-docker:2", options: {}, why: "配布前に確かめる" };

test("入れ替えても、足した道具は残る", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", devcontainer_features: [FEAT] });

  const result = run("update", root);

  assert.equal(result.message, null, result.message ?? "");
  assert.deepEqual(configOf(root).app.devcontainer_features, [FEAT], "入れ替えで消えている");
  assert.ok(
    readFileSync(join(root, ".devcontainer", "devcontainer.json"), "utf8").includes(FEAT.id),
    "作業場の定義に出ていない",
  );
});

test("なぜ要るのかが無ければ、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", devcontainer_features: [{ id: "a/b:1" }] });

  const result = run("update", root);

  assert.equal(result.code, 1);
  assert.ok(result.message.includes("why"), result.message);
  assert.ok(result.message.includes("a/b:1"), `どれが悪いのかを出していない: ${result.message}`);
});

test("道具の名前が無ければ、進めずに止まる", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes", devcontainer_features: [{ why: "理由" }] });
  assert.equal(run("update", root).code, 1);
});

test("持っていなくても、そのまま通る", () => {
  const root = project();
  run("init", root);
  writeRawConfig(root, { screen: "yes" });
  assert.equal(run("update", root).message, null);
  assert.deepEqual(configOf(root).app.devcontainer_features, []);
});

// **使えない構成で黙って持たせない。** Feature は Dev Container 仕様のものである。
test("サンドボックスが devcontainer でなければ、進めずに止まる", () => {
  const root = project();
  run("init", root);
  const ports = { ...defaults().ports, sandbox: NONE };
  writeFileSync(
    join(root, CONFIG_FILE),
    JSON.stringify({ version: 1, language: "ja", ports, app: { devcontainer_features: [FEAT] } }, null, 2),
    "utf8",
  );

  const result = run("update", root);

  assert.equal(result.code, 1);
  assert.ok(result.message.includes("ports.sandbox"), result.message);
  assert.ok(result.message.includes("効かない"), `なぜ駄目かを言っていない: ${result.message}`);
});
