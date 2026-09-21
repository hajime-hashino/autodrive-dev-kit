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
import { QUALITY_FILE, render, summarize, unfilled } from "../src/vendored/internal/quality.js";
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
  assert.match(text, /記録: 3 件 \/ 作業単位 2 件/, "分母が出ていない");
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
