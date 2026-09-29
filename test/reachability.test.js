/**
 * 許可した宛先へ、いま本当に出られるか。
 *
 * **規則に何が書いてあるかではなく、出られるかを測る。** 規則は起動時に解決した
 * IP に対して置かれるため、宛先が IP を入れ替えると、一覧にあっても出られなくなる。
 * 静かに起きるので、**許可一覧の項目が用を成していないと誤って結論した**（AUT-161）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkAll, hostsIn, report } from "../src/vendored/internal/reachability.js";
import { run } from "../src/vendored/internal/sandboxCli.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/tmp.js";

// ------------------------------------------------------------ 一覧を読む

test("空行と注釈を飛ばして、宛先だけを読む", () => {
  const out = hostsIn(["# 注釈", "", "api.github.com         # 提出", "  github.com  ", "# 末尾"].join("\n"));
  assert.deepEqual(out, ["api.github.com", "github.com"]);
});

test("同じ宛先を二重に数えない", () => {
  assert.deepEqual(hostsIn("a.example\na.example  # 別の理由\n"), ["a.example"]);
});

test("一覧が空でも落ちない", () => {
  for (const empty of ["", "\n# だけ\n", null, undefined]) assert.deepEqual(hostsIn(empty), []);
});

// ------------------------------------------------------------ 報告

/** 測った結果を装う。 */
const ok = (host) => ({ host, reachable: true, reason: null });
const ng = (host, reason) => ({ host, reachable: false, reason });

test("全部へ出られるなら、件数だけを言う", () => {
  const { lines, code } = report([ok("a"), ok("b")]);
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /All 2 allowed/);
});

// **出られたものを並べない。** 並べると、出られなかったものが埋もれる。
test("出られない宛先だけを並べ、失敗として返す", () => {
  const { lines, code } = report([ok("つながる.example"), ng("塞がる.example", "つながらない")]);
  const text = lines.join("\n");
  assert.equal(code, 1);
  assert.match(text, /塞がる\.example/);
  assert.equal(/つながる\.example/.test(text), false, "出られたものまで並べている");
});

// **直し方まで言う。** 言わないと、宛先の不調か自分の誤りかを疑うことになる。
test("直し方と、直らない場合のことまで言う", () => {
  const text = report([ng("塞がる.example", "つながらない")]).lines.join("\n");
  assert.match(text, /init-firewall\.sh/, "置き直す手が無い");
  assert.match(text, /swap/, "なぜ起きるのかが無い");
  assert.match(text, /unreachable even after re-placing/, "追いつかない宛先があることが無い");
});

// ------------------------------------------------------------ まとめて測る

test("全部を測り、結果をそのまま返す", async () => {
  const probed = [];
  const fake = async (host) => {
    probed.push(host);
    return host === "塞がる.example" ? ng(host, "つながらない") : ok(host);
  };
  const results = await checkAll(["a.example", "塞がる.example"], fake);
  assert.deepEqual(probed.sort(), ["a.example", "塞がる.example"]);
  assert.equal(results.filter((r) => !r.reachable).length, 1);
});

// ------------------------------------------------------------ 入口

/** 許可一覧を持つ起点。 */
function workspace(text) {
  const root = tempDir("autodrive-reach-");
  mkdirSync(join(root, ".devcontainer"), { recursive: true });
  writeFileSync(join(root, ".devcontainer", "allowed-domains.txt"), text, "utf8");
  return root;
}

test("一覧を読んで測り、出られないものがあれば失敗で返す", async () => {
  const root = workspace("# 注釈\napi.example\n塞がる.example\n");
  const { output, code } = await run(["宛先を確かめる"], root, async (host) =>
    host === "塞がる.example" ? ng(host, "つながらない") : ok(host),
  );
  assert.equal(code, 1);
  assert.match(output, /塞がる\.example/);
});

// **無いことを、出られないことと混ぜない。** 直す先が違う。
test("一覧が無ければ、出られないとは言わない", async () => {
  const root = tempDir("autodrive-reach-none-");
  const { output, code } = await run(["宛先を確かめる"], root, async (h) => ok(h));
  assert.equal(code, 1);
  assert.match(output, /There is no allowlist/);
  assert.equal(/unreachable/.test(output), false, "無いことを出られないことと混ぜている");
});

test("知らない操作は、使い方を出して失敗で返す", async () => {
  const { output, code } = await run(["まだ無い操作"], workspace("a.example\n"), async (h) => ok(h));
  assert.equal(code, 1);
  assert.match(output, /Unknown operation/);
});
