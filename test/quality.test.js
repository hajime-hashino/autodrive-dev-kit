/**
 * 品質の証跡が、証跡のままであること。
 *
 * **点を付けた瞬間に、定義§1と衝突する。**「測れない基準を指標に置くと、達成した
 * ことにできてしまう」。したがって**良し悪しを言わないこと自体を判定する。**
 *
 * **そして、空欄を作らないこと。** 0件を黙って出すと「問題なし」と読まれる。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { QUALITY_FILE, findings, render, summarize, unfilled } from "../src/vendored/internal/quality.js";
import { run } from "../src/vendored/internal/qualityCli.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/tmp.js";

/** 記録1件。必須属性はアダプタが付けるため、ここでは読む側が使うものだけ置く。 */
const ev = (type, extra = {}) => ({ type, work_item_id: "AUT-1", ...extra });

function summary(events = [], quality = [{ repo: "app", body: "# 品質管理\n" }]) {
  return summarize({ events, quality });
}

// ------------------------------------------------------------------ 分母

// **件数だけを出さない。** 手戻り0件は、良いのか記録していないのかが区別できない。
test("分母を出す", () => {
  const data = summary([ev("miss"), ev("rework"), ev("miss", { work_item_id: "AUT-2" })]);
  assert.equal(data.scale.events, 3);
  assert.equal(data.scale.workItems, 2, "作業単位の数を数えていない");

  const text = render(data);
  assert.match(text, /合計: 記録 3 件 \/ 作業単位 2 件/, "分母が出ていない");
});

// ------------------------------------------------------- 空欄を作らない

// **0件を黙って出さない。** 「起きなかった」と「記録していない」は別である。
test("記録が在って0件なら、区別できないことまで言う", () => {
  const text = render(summary([ev("stop", { stop_type: "入力" })]));
  assert.match(text, /検出漏れが起きなかったのか、記録していないのかは/, "区別できないと言っていない");
});

// **記録そのものが無い場合は、そう言う。** 上と同じ文にすると、状況が違うのに同じに読める。
test("記録そのものが無いなら、そう言う", () => {
  const text = render(summary([]));
  assert.match(text, /記録そのものが1件も無い/, "何も記録が無いことを言っていない");
});

// ------------------------------------------------- 何を確かめると決めたか

test("置き場が無ければ、決まっていないと言う", () => {
  const text = render(summary([], [{ repo: "app", body: null }]));
  assert.ok(text.includes(`**${QUALITY_FILE} が無い。何を確かめるかが決まっていない。**`), "無いと言っていない");
});

// **テンプレートのまま残っている欄を、埋まっていると読ませない。**
test("未記入の欄を見つける", () => {
  const body = "| 機能 | 単体 | （例：自動テスト） | |\n| 性能 | | | |\n";
  assert.equal(unfilled(body).length, 1, "例の行を拾えていない");
  assert.equal(unfilled(null).length, 0, "置かれていない場合に落ちている");

  // **英語の雛形の目印も、前の版の日本語の目印も拾う**（AUT-263）。既に配った
  // docs/quality.md はプロジェクトのものであり、update でも日本語のまま残る。
  assert.equal(unfilled("| Functionality | Unit | (example: automated tests) | |\n").length, 1, "英語の例を拾えていない");
  assert.equal(unfilled("## What to build\n\n(write here)\n").length, 1, "英語の記入欄を拾えていない");
  assert.equal(unfilled("## 何を作るか\n\n（ここに書く）\n").length, 1, "前の版の記入欄を拾えていない");
  // **普通の文を、未記入と読まない。** 利用者は自分で (e.g. ...) と書く。
  assert.equal(unfilled("| Security | Static | Dependency scanning (e.g. npm audit) | all |\n").length, 0, "利用者の文を未記入と読んでいる");

  const text = render(summary([], [{ repo: "app", body }]));
  assert.match(text, /未記入の欄が 1 行ある/, "未記入を出していない");
});

// ------------------------------------------------------- 見ていない範囲

// **見た範囲だけを出さない**（定義§8）。見ていない範囲が無いと、全部見たと読まれる。
test("抜き取り確認は、見ていない範囲を必ず出す", () => {
  const data = summary([
    ev("sampling", { area: "画面", looked: "一覧", not_looked: "印刷", fixed: false }),
  ]);
  assert.equal(data.sampled[0].notLooked, "印刷");

  const text = render(data);
  assert.match(text, /\*\*見ていない: 印刷\*\*/, "見ていない範囲が強調されていない");
  assert.match(text, /修正は入らなかった/, "修正の有無が出ていない");
});

// **記録に無いものを、空文字で出さない。** 空欄は「問題なし」と読まれる。
test("記録に無い項目は、そう書く", () => {
  const data = summary([ev("sampling", { area: "画面" })]);
  assert.equal(data.sampled[0].notLooked, "（記録に無い）");
});

// --------------------------------------------------------- 点を付けない

// **良し悪しを言わない**（定義§1）。言った瞬間に、測れない基準を測ったことになる。
test("点を付けず、言っていないことを明示する", () => {
  const text = render(summary([ev("miss", { found_in: "本番", cause: "実装バグ" })]));

  assert.match(text, /これは品質の点数ではない/, "点数ではないと言っていない");
  assert.match(text, /プロダクトの品質が良いことを示していない/, "言えないことを言っていない");
  // **通るテストは何も見ていなくても通る。** ここを書かないと、件数が保証に読まれる。
  assert.match(text, /通るテストは、何も見ていなくても通る/, "手段の正しさへの注意が無い");

  // **点の形を出さない。** 割合・合否・評語のどれも、良し悪しの宣言になる。
  for (const shape of [/\d+\s*[%％]/, /合格|不合格/, /良好|不良/, /スコア/, /評価: /]) {
    assert.equal(shape.test(text), false, `点の形が出ている: ${shape}`);
  }
});

// ------------------------------------------------------------------ 入口

test("既定は text、scope と format を確かめる", () => {
  assert.equal(run(["--format", "yaml", "--root", "."]).code, 2, "知らない形式を通している");
  assert.equal(run(["--scope", "all", "--root", "."]).code, 2, "知らない範囲を通している");
  assert.equal(run(["--help"]).code, 0);
});

// **判定ではない。** 良し悪しを終了コードで表すと、通ることが保証に見える。
test("良し悪しを終了コードで表さない", () => {
  const { code, output } = run(["--root", ".", "--scope", "self"]);
  assert.equal(code, 0, "読めたのに 0 以外を返している");
  assert.match(output, /品質の証跡/, output.slice(0, 200));
});

test("リポジトリが無ければ、理由を言って止まる", () => {
  const { code, output } = run(["--root", "/nonexistent-path-for-test", "--scope", "self"]);
  assert.equal(code, 2);
  assert.match(output, /リポジトリが見つからない/, output);
});

// **読めなかった記録を黙らない。** 黙ると、読めた分が全部だと受け取られる。
// 壊れた行の分だけ、どの数も実際より小さく出ている。
test("読めなかった記録を、隠さない", () => {
  const root = tempDir("autodrive-quality-");
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  mkdirSync(join(root, "telemetry"), { recursive: true });
  writeFileSync(
    join(root, "telemetry", "AUT-1.jsonl"),
    '{"type":"miss","work_item_id":"AUT-1"}\nこれは JSON ではない\n',
    "utf8",
  );

  const { output, code } = run(["--root", root, "--scope", "self"]);
  assert.equal(code, 0);
  assert.match(output, /読めなかった記録（1 件）/, `読めなかった行を隠している:\n${output}`);
  assert.match(output, /上のどの数にも入っていない/, "数に入っていないことを言っていない");
});

// ------------------------------------------------------------- 読みどころ
//
// **並べるだけにしない**（人の指摘）。数を出して「あとは読んだ人が判断してください」
// で終えると、**分析を人へ押し付けたことになる。** 判断のコストを下げるのが役割で
// あり、判断を消すことではない。
//
// **ただし良し悪しは言わない**（定義§1）。言うのは「何が起きているか」と
// 「次に何をするか」であって、「良い／悪い」ではない。

test("読みどころが、観察・理由・次にすることの3つを持つ", () => {
  const notes = findings(
    summary([
      ev("miss", { found_in: "本番", cause: "実装バグ" }),
      ev("rework", { cause: "設計のズレ" }),
    ]),
  );
  assert.notEqual(notes.length, 0, "読みどころを1つも出していない");
  for (const n of notes) {
    assert.ok(n.observation, "観察が無い");
    assert.ok(n.why, "なぜ気になるかが無い");
    assert.ok(n.next, "次にすることが無い");
  }
});

// **本番で見つかったことを見逃さない。** その手前のどこも捕まえていない。
test("本番で見つかった検出漏れを、読みどころに出す", () => {
  const notes = findings(summary([ev("miss", { found_in: "本番" })]));
  const n = notes.find((x) => x.observation.includes("本番で見つかっている"));
  assert.ok(n !== undefined, "本番の検出漏れを出していない");
  // **分母を添える。** 割合にすると、数の大小がそのまま評価に読まれる。
  assert.match(n.observation, /1 件のうち 1 件/, `分母が無い: ${n.observation}`);
});

// **決まっていないことを、読みどころの側でも言う。** 表の空欄は読み飛ばされる。
test("何を確かめるか決まっていないことを、読みどころに出す", () => {
  const notes = findings(summary([ev("miss")], [{ repo: "app", body: null }]));
  assert.ok(
    notes.some((n) => n.observation.includes("何を確かめるかが決まっていない")),
    "決まっていないことを読みどころに出していない",
  );
});

// **記録に無い分を、内訳から黙って落とさない。** 合計が全体と合わなくなる。
test("記録に無い内訳を、読みどころに出す", () => {
  const notes = findings(summary([ev("stop")]));
  const n = notes.find((x) => x.observation.includes("停止の種別が記録に無い"));
  assert.ok(n !== undefined, "記録に無い分を出していない");
  assert.match(n.why, /どの内訳にも入っていない/, "何が起きるかを言っていない");
});

// **読みどころでも、良し悪しを言わない。**
test("読みどころが、良し悪しを言わない", () => {
  const text = render(summary([ev("miss", { found_in: "本番", cause: "実装バグ" })]));
  assert.match(text, /## 読みどころ/, "読みどころが出ていない");
  assert.match(text, /どれを直すか、直さないかは人が決める/, "決めるのが人だと言っていない");
  for (const shape of [/\d+\s*[%％]/, /合格|不合格/, /良好|不良/, /スコア/, /評価: /]) {
    assert.equal(shape.test(text), false, `点の形が出ている: ${shape}`);
  }
});

// -------------------------------------------------------------- 対象の説明
//
// **リポジトリごとに観点が違う**（人の指摘）。名前だけ並べても、読み手は
// どこからの話かを追えない。
test("対象が、リポジトリごとの内訳と観点の出どころを示す", () => {
  const text = render(
    summarize({
      events: [{ type: "miss", work_item_id: "A", source: "app/telemetry/A.jsonl" }],
      quality: [
        { repo: "app", body: "# 品質管理\n" },
        { repo: "docs-only", body: null },
      ],
    }),
  );
  // **観点はリポジトリごとに違うこと。**
  assert.match(text, /観点は、?リポジトリごとに違う|観点かは、リポジトリごとに違う/, "観点の違いを言っていない");
  // **記録の件数を、リポジトリごとに出す。**
  assert.match(text, /\| app \| 1 件 \|/, "リポジトリごとの件数が出ていない");
  assert.match(text, /\| docs-only \| 0 件 \|/, "記録が無いリポジトリが出ていない");
});

// **出力に載ることまで見る。** 関数が正しくても、載らなければ読む人には届かない。
// **ここが抜けていた。** `findings()` だけを試験し、出口を見ていなかったため、
// 読みどころを落とす変異が2件とも生き残った。
test("読みどころが、出力に載る", () => {
  const text = render(
    summary([ev("miss", { found_in: "本番", cause: "実装バグ" }), ev("rework", { cause: "設計のズレ" })]),
  );

  // 観察がそのまま出ていること。
  assert.match(text, /検出漏れ 1 件のうち 1 件が本番で見つかっている/, `観察が載っていない:\n${text}`);
  // **次にすることが出ていること。** 観察だけでは何をすればよいか分からない。
  assert.match(text, /\*\*次にすること:\*\*/, "次にすることが載っていない");
  // **番号が振られ、複数出ること。**
  assert.match(text, /^ {2}2\. /m, `読みどころが1件しか載っていない:\n${text}`);
});
