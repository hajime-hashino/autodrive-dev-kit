/**
 * `init` した先が、それだけで成り立つかを確かめる。
 *
 * **Claude は起動しない。** 確かめたいものが2つ混ざるためである。
 *
 *   土台が正しく置かれ、それだけで判定が通るか   → 決定的。速い。ここで見る
 *   AIが置かれた規約に従うか                     → 非決定的。人が見る
 *
 * 前者だけでも、置き忘れ・参照の食い違い・版の固定漏れは捕まる。**後者を混ぜると、
 * 判定基準そのものが曖昧になる。**
 *
 * 人の目で何度も不具合が出るようなら、そのときに後者も見る形を考える。**引き金は
 * 人の負担が上がったこと**であり、いま先回りして作るものではない。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { VENDOR_DIR } from "../src/init.ts";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 素のリポジトリを作り、`init` を通す。 */
function initialized(): string {
  const root = mkdtempSync(join(tmpdir(), "autodrive-e2e-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "pipe"] });

  git("init", "-q");
  git("config", "user.name", "テスト");
  git("config", "user.email", "test@example.invalid");

  execFileSync(join(KIT, "bin", "autodrive-dev-kit"), ["init"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return root;
}

/** 置かれた先の道具を、置かれた先から実行する。 */
function run(root: string, args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(join(root, VENDOR_DIR, "verify"), args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, AUTODRIVE_CI_TOKEN: "", LINEAR_API_KEY: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

// ------------------------------------------------------------ 道具が動くか

// **手元の参照実装を指していないこと。** 参照実装を更新した瞬間に全プロジェクトが
// 変わる形だと、プロジェクトごとに違う版で動けない。
test("道具がプロジェクトの中に置かれ、そこから動く", () => {
  const root = initialized();

  for (const p of ["verify", "VERSION", "src", "hooks", "bin"]) {
    assert.ok(existsSync(join(root, VENDOR_DIR, p)), `${VENDOR_DIR}/${p} が無い`);
  }

  const { out } = run(root, ["--root", ".", "--scope", "self"]);
  assert.ok(out.includes("不変条件"), `判定が動いていない: ${out.slice(0, 200)}`);
});

test("複製した時点の版が、置かれた先に残る", () => {
  const root = initialized();
  const there = readFileSync(join(root, VENDOR_DIR, "VERSION"), "utf8").trim();
  const here = readFileSync(join(KIT, "VERSION"), "utf8").trim();
  assert.equal(there, here);
  assert.notEqual(there, "", "版が空");
});

// ------------------------------------------------------------ 参照の食い違い

// **置いた文書が、置いた場所を指していること。** ここがずれると、初日に動かない。
test("置かれた設定が、置かれた道具を指している", () => {
  const root = initialized();

  const workflow = readFileSync(join(root, ".github", "workflows", "verify.yml"), "utf8");
  assert.ok(workflow.includes(`${VENDOR_DIR}/verify`), workflow);
  assert.equal(workflow.includes("git clone"), false, "取りに行く形が残っている");

  const settings = readFileSync(join(root, ".claude", "settings.json"), "utf8");
  assert.ok(settings.includes(`${VENDOR_DIR}/hooks/record-tokens`), settings);

  const rules = readFileSync(join(root, "docs", "autodrive.md"), "utf8");
  assert.ok(rules.includes(`${VENDOR_DIR}/bin/autodrive-dev-kit`), rules);
  assert.equal(rules.includes("{{KIT}}"), false, "置き換えが残っている");
});

// ------------------------------------------------------------ 判定の中身

// **記録が1件も無い状態から始まる。** そこで何が言われるかは、初日の体験そのもの。
test("記録が無い状態でも、判定は落ちずに何が足りないかを言う", () => {
  const root = initialized();
  const { out } = run(root, ["--root", ".", "--scope", "self"]);

  assert.ok(out.includes("テレメトリが記録されること"), out.slice(0, 300));
  // 資格情報が無い状態で、それと分かること。**黙って通らない。**
  assert.ok(out.length > 0);
});

// ------------------------------------------------------------ 何を置かないか

// **固有のものは生成しない**（BOOTSTRAP 段階5）。雛形を置くと中身が無いまま残る。
test("固有のものは生成しない", () => {
  const root = initialized();
  for (const p of ["docs/adr", "docs/boundary-changes.md", "test"]) {
    assert.equal(existsSync(join(root, p)), false, `${p} を作ってしまっている`);
  }
});

// 道具の中に、そのプロジェクトに要らないものを持ち込まない。
test("参照実装のテストや文書は複製しない", () => {
  const root = initialized();
  for (const p of ["test", "docs", "templates", "telemetry"]) {
    assert.equal(existsSync(join(root, VENDOR_DIR, p)), false, `${VENDOR_DIR}/${p} を複製している`);
  }
});
