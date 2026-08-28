/**
 * `init` / `apply` / `update`。
 *
 * **端末を要求しない。** ヒアリングはポートになっており、ここでは答えを差し込む。
 * 端末が要るとテストが動かせず、判定されないものはいずれ壊れる。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { QUESTIONS, setup } from "../src/setup.ts";
import type { Mode } from "../src/setup.ts";
import { CONFIG_FILE, NONE, PORT_NAMES, UNKNOWN, infer, readConfig } from "../src/config.ts";
import { chosen, render } from "../src/adapters/interviewTerminal.ts";
import { useRecommended } from "../src/ports/interview.ts";
import type { InterviewPort, Question } from "../src/ports/interview.ts";
import type { PortName } from "../src/config.ts";

/** 聞かれた問い。どのポートについてかも見る。 */
type Asked = Question & { port: PortName };

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "autodrive-setup-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

/** 決まった答えを返す。**問いも記録する。** 何を聞かれたかが判定の対象になる。 */
function answering(answers: Record<string, string>): InterviewPort & { asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    answer(q) {
      asked.push(q as Asked);
      return answers[q.ask] ?? null;
    },
  };
}

const run = (mode: Mode, root: string, port: InterviewPort = useRecommended) =>
  setup(mode, root, KIT, port);

const configOf = (root: string) => readConfig(root).config;

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
for (const mode of ["init", "apply"] as const) {
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
  for (const q of QUESTIONS) assert.notEqual(q.port as string, "app");
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
  assert.ok(first.todo.some((t) => t.includes(".env")), first.todo.join(" / "));

  writeFileSync(join(root, ".env"), "LINEAR_API_KEY=x\n", "utf8");
  const again = run("update", root);
  assert.equal(again.todo.some((t) => t.includes(".env")), false, again.todo.join(" / "));
  // 入れ替えは、既に動いているプロジェクトに打つ。始め方の案内も要らない。
  assert.equal(again.todo.some((t) => t.includes("はじめる")), false, again.todo.join(" / "));
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
  const config = readConfig(root).config as unknown as { ports: Record<string, string> };
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
