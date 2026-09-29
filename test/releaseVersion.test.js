/**
 * バージョンを上げ忘れたことに、気づけること。
 *
 * **判定そのものが空回りしていないかまで見る。** 「落とさなかった」は、見ていなくても
 * 出る。捕まえられないものを、捕まえた気にさせるものは置かない（配布物「確認の手段は、
 * 作った時点で検証する」）。
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { TEMPLATES_DIR, VENDORED_META, VENDORED_ROOT } from "../src/vendored/internal/init.js";
import {
  DISTRIBUTED,
  changedBetween,
  checkBump,
  distributedChanges,
  inspect,
  isDistributed,
  isNewer,
  parseVersion,
  versionAt,
} from "../src/vendored/internal/releaseVersion.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------ 配られるものの範囲

// **一覧が痩せていないこと。** 対象が減れば判定は静かに通るようになる。何も
// 落とさなくなったことに、件数を見ていないと気づけない。
test("配られるものの一覧が、実際に配るものから導かれている", () => {
  assert.ok(DISTRIBUTED.includes(VENDORED_ROOT), "複製の中身が、判定の対象に入っていない");
  for (const name of VENDORED_META) {
    if (name === "VERSION") continue;
    assert.ok(DISTRIBUTED.includes(name), `複製されるのに、判定の対象に入っていない: ${name}`);
  }
  // **VERSION 自身は引き金にしない。** それが動いたかを見る側である。
  assert.equal(DISTRIBUTED.includes("VERSION"), false, "VERSION を引き金にしている");
  // **テンプレートも配る。** 複製はされないが、init と update がここから作る。
  assert.ok(DISTRIBUTED.includes(TEMPLATES_DIR), "テンプレートを見ていない");
});

test("配られるものの一覧が、実在するものを指している", () => {
  for (const name of DISTRIBUTED) {
    assert.ok(existsSync(join(KIT, name)), `一覧にあるのに実在しない: ${name}`);
  }
});

test("配られる場所と、配られない場所を見分ける", () => {
  for (const yes of [
    "src/vendored/internal/init.js",
    "src/vendored/bin/autodrive-dev-kit",
    "src/vendored/hooks/record-tokens",
    "src/templates/autodrive.md",
    "package.json",
  ]) {
    assert.ok(isDistributed(yes), `配られるのに、対象から外している: ${yes}`);
  }
  for (const no of ["test/init.test.js", "docs/adr/README.md", "telemetry/AUT-155.jsonl", "mutations/regression.json", "README.md", ".github/workflows/invariants.yml"]) {
    assert.equal(isDistributed(no), false, `配られないのに、対象にしている: ${no}`);
  }
  // **名前の前方一致で拾わない。** `vendoredish/x` は `vendored` の中ではない。
  assert.equal(isDistributed("src/vendoredish/x.js"), false, "似た名前を拾っている");
  // **`src` の直下は、それだけでは配られない。** 配る境界は1つ下にある。
  assert.equal(isDistributed("src/おいただけのもの.js"), false, "src の直下を配っている");
});

test("変わったもののうち、配られるものだけを取り出す", () => {
  assert.deepEqual(
    distributedChanges(["docs/a.md", "src/vendored/internal/b.js", "test/c.test.js"]),
    ["src/vendored/internal/b.js"],
  );
  assert.deepEqual(distributedChanges(["docs/a.md"]), []);
});

// ------------------------------------------------------------ バージョンの読み方

test("バージョンを読む", () => {
  assert.deepEqual(parseVersion("0.1.0"), [0, 1, 0]);
  assert.deepEqual(parseVersion(" 1.20.3\n"), [1, 20, 3]);
  for (const bad of ["v0.1.0", "0.1", "0.1.0-rc1", "", null, undefined, "わからない"]) {
    assert.equal(parseVersion(bad), null, `読めない形を通している: ${bad}`);
  }
});

test("後の版かどうかを見る", () => {
  assert.equal(isNewer("0.1.0", "0.1.1"), true);
  assert.equal(isNewer("0.1.9", "0.2.0"), true);
  assert.equal(isNewer("0.9.0", "1.0.0"), true);
  assert.equal(isNewer("0.1.0", "0.1.0"), false, "同じものを後だとしている");
  assert.equal(isNewer("0.2.0", "0.1.9"), false, "下がっているのを通している");
  assert.equal(isNewer("0.1.0", "v0.1.1"), false, "読めない形を通している");
  // **桁ではなく数で比べる。** 文字として比べると 0.1.10 が 0.1.9 より前になる。
  assert.equal(isNewer("0.1.9", "0.1.10"), true, "文字として比べている");
});

// ------------------------------------------------------------ 判定

test("配られる中身が変わったのに上げていなければ、落とす", () => {
  const r = checkBump({ changed: ["src/vendored/internal/init.js"], base: "0.1.0", head: "0.1.0" });
  assert.equal(r.ok, false);
  // **なぜ・何をすればよいかが出ていること**（配布物「停止するときの作法」）。
  assert.match(r.message, /kit_version/, "なぜ困るのかが無い");
  assert.match(r.message, /Raise the last number of VERSION by one/, "何をすればよいかが無い");
  assert.match(r.message, /package\.json/, "揃える先が無い");
  assert.match(r.message, /src\/vendored\/internal\/init\.js/, "どれが引っかかったのかが無い");
});

test("配られない場所だけの変更では、上げることを求めない", () => {
  const r = checkBump({
    changed: ["test/init.test.js", "docs/adr/README.md", "mutations/regression.json"],
    base: "0.1.0",
    head: "0.1.0",
  });
  assert.equal(r.ok, true, r.message);
});

test("上げるだけの提出は、通る", () => {
  // VERSION と package.json だけが動く形。**package.json は配られるため引っかかるが、
  // VERSION も動いているので通る。**
  const r = checkBump({ changed: ["VERSION", "package.json"], base: "0.1.0", head: "0.1.1" });
  assert.equal(r.ok, true, r.message);
});

test("上げていれば、通る", () => {
  const r = checkBump({ changed: ["src/vendored/internal/init.js", "VERSION"], base: "0.1.0", head: "0.1.1" });
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /0\.1\.0 → 0\.1\.1/);
});

test("下げていたら、落とす", () => {
  const r = checkBump({ changed: ["src/vendored/internal/init.js"], base: "0.2.0", head: "0.1.0" });
  assert.equal(r.ok, false);
  assert.match(r.message, /went down/);
});

test("読めない形にしていたら、落とす", () => {
  const r = checkBump({ changed: ["src/vendored/internal/init.js"], base: "0.1.0", head: "v0.1.1" });
  assert.equal(r.ok, false);
  assert.match(r.message, /Write it as `1\.2\.3`/, "どう書けばよいかが無い");
});

// **調べられなかったことを、通過として扱わない**（定義§9）。
test("比べられなかったときは、通さない", () => {
  const r = checkBump({ changed: null, base: "0.1.0", head: "0.1.0" });
  assert.equal(r.ok, false);
  assert.match(r.message, /fetch-depth/, "何をすればよいかが無い");
});

test("VERSION を読めなかったときは、通さない", () => {
  assert.equal(checkBump({ changed: ["src/a.js"], base: "0.1.0", head: null }).ok, false);
});

// **新しく置いたときを、上げ忘れとして落とさない。** 比べる相手がまだ無い。
test("既定ブランチにまだ VERSION が無ければ、置いたものとして通す", () => {
  const r = checkBump({ changed: ["src/vendored/internal/init.js"], base: null, head: "0.1.0" });
  assert.equal(r.ok, true, r.message);
});

// ------------------------------------------------------------ git から読む

/** 決めた答えを返す git。**実際のリポジトリの状態に判定を依存させない。** */
function fakeGit(table) {
  return (args) => {
    const key = args.join(" ");
    return key in table ? table[key] : null;
  };
}

test("2点の間で変わったファイルを読む", () => {
  const git = fakeGit({ "diff --name-only A...B": "src/vendored/internal/init.js\n\nsrc/templates/autodrive.md\n" });
  assert.deepEqual(changedBetween("A", "B", git), ["src/vendored/internal/init.js", "src/templates/autodrive.md"]);
  assert.equal(changedBetween("A", "C", git), null, "読めなかったのを空として返している");
});

test("その地点の VERSION を読む", () => {
  const git = fakeGit({ "show A:VERSION": "0.1.0\n" });
  assert.equal(versionAt("A", git), "0.1.0");
  assert.equal(versionAt("B", git), null);
});

test("git から集めて判定する", () => {
  const caught = inspect(
    "A",
    "B",
    fakeGit({
      "diff --name-only A...B": "src/vendored/internal/init.js\n",
      "show A:VERSION": "0.1.0\n",
      "show B:VERSION": "0.1.0\n",
    }),
  );
  assert.equal(caught.ok, false, "上げ忘れを見逃している");

  const passed = inspect(
    "A",
    "B",
    fakeGit({
      "diff --name-only A...B": "src/vendored/internal/init.js\nVERSION\n",
      "show A:VERSION": "0.1.0\n",
      "show B:VERSION": "0.1.1\n",
    }),
  );
  assert.equal(passed.ok, true, passed.message);
});

// ------------------------------------------------------------ 実物

// **2か所に同じ値がある。** タグは VERSION から打たれ、npm は package.json を見る。
// 食い違うと、タグの名前と中身のバージョンが別のものを指す。
test("VERSION と package.json の version が一致している", () => {
  const version = readFileSync(join(KIT, "VERSION"), "utf8").trim();
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  assert.equal(pkg.version, version, "VERSION と package.json の version が違う");
});

test("VERSION が、タグにできる形をしている", () => {
  const version = readFileSync(join(KIT, "VERSION"), "utf8").trim();
  assert.notEqual(parseVersion(version), null, `タグ名にならない: ${version}`);
});
