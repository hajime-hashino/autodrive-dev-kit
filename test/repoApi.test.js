/**
 * 判定が Repo を読む鍵（ADK-144、ADR 0015）。
 *
 * **CI では読むだけの鍵、手元ではエージェントの鍵で読む。** 手元で鍵を分けても
 * 守れるものが無かった。エージェントは判定のコードも書き換えられ、書ける鍵も持っている。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { judgingToken } from "../src/vendored/internal/repoApi.js";

test("CI の鍵があれば、それで読む", () => {
  assert.equal(judgingToken({ AUTODRIVE_CI_TOKEN: "ci", GH_TOKEN: "w" }), "ci");
});

// **以前は、判定の鍵が無ければ手元で横断の判定を打てなかった**（.env に置かせていた）。
test("CI の鍵が無ければ、エージェントの鍵で読む", () => {
  assert.equal(judgingToken({ GH_TOKEN: "w" }), "w");
  assert.equal(judgingToken({ AUTODRIVE_CI_TOKEN: "", GH_TOKEN: "w" }), "w");
});

test("どちらも無ければ、鍵は無い", () => {
  assert.equal(judgingToken({}), undefined);
  assert.equal(judgingToken({ AUTODRIVE_CI_TOKEN: "", GH_TOKEN: "" }), undefined);
});
