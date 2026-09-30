/**
 * 配った先で動くか。
 *
 * **`node_modules` の中で動くことを確かめる。** Node は node_modules の下にある
 * ファイルの型注釈を意図的に剥がさない。実装が型注釈を含んでいると、npx で
 * 入れた瞬間に動かなくなる（AUT-97）。
 *
 * **手元のパスを指した確認は、この経路を通らない。** npm はローカルのパスに
 * シンボリックリンクを張るため、実体は node_modules の外に残る。そちらで確かめて
 * 「動いた」と報告した（AUT-96）。**動いたのは、たまたま制約に当たらない経路
 * だったからである。**
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempDir } from "./helpers/tmp.js";
import { TEMPLATES_DIR, VENDORED_META, VENDORED_ROOT } from "../src/vendored/internal/init.js";

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 配るものを、node_modules の下へ実体で置く。**リンクにしない。** */
function installed() {
  const root = tempDir("autodrive-pkg-");
  const dest = join(root, "node_modules", "autodrive-dev-kit");
  mkdirSync(dest, { recursive: true });

  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  for (const entry of [...pkg.files, "package.json"]) {
    cpSync(join(KIT, entry), join(dest, entry), { recursive: true });
  }
  execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });
  return { root, entry: join(dest, pkg.bin["autodrive-dev-kit"]) };
}

// **これが本番の経路である。** ここが通らなければ、npx では使えない。
test("node_modules の中からでも動く", () => {
  const { root, entry } = installed();
  const out = execFileSync(process.execPath, [entry, "init"], { cwd: root, encoding: "utf8" });

  assert.ok(out.includes("Set up the foundation"), out.slice(0, 300));
  assert.ok(statSync(join(root, "autodrive")).isDirectory(), "autodrive-dev-kit が置かれていない");
});

test("node_modules の中からでも、判定が動く", () => {
  const { root, entry } = installed();
  execFileSync(process.execPath, [entry, "init"], { cwd: root, stdio: "ignore" });

  // **終了コードで判断しない。** 記録が1件も無い状態では「要対応」が出て 1 を
  // 返す。それは正しい挙動であり、ここで見たいのは動くかどうかである。
  let out;
  try {
    out = execFileSync(join(root, "autodrive", "invariants"), ["--root", ".", "--scope", "self"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, AUTODRIVE_CI_TOKEN: "", LINEAR_API_KEY: "" },
    });
  } catch (error) {
    out = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  assert.ok(out.includes("Invariant status"), out.slice(0, 300));
});

// **配るものに型注釈を残さない。** 1つでも残ると、その経路を通った瞬間に落ちる。
test("配るものに、剥がせない型注釈が残っていない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));

  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".ts")) found.push(relative(KIT, path));
    }
  };
  for (const entry of pkg.files) {
    const path = join(KIT, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (entry.endsWith(".ts")) found.push(entry);
  }

  assert.deepEqual(found, [], `配るものに型注釈のファイルが残っている:\n${found.join("\n")}`);
});

// **型は文書として残っていること。** 剥がした跡に説明だけが残り、何も説明して
// いない状態を作らない。実際に、変換した直後がその状態だった（AUT-97）。
test("参照されている型が、すべて定義されている", async () => {
  const { readdirSync } = await import("node:fs");

  const defined = new Set();
  const used = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!name.endsWith(".js")) continue;
      const body = readFileSync(path, "utf8");
      // **コメントの塊をまたがないこと。** またぐと、1つ目の型の名前を読み飛ばし、
      // 間にある文章を型の中身として読む。**落ちるが、落ちる理由が嘘になる。**
      // 実際に、そう読んだ（AUT-112）。
      const TYPEDEF = /@typedef \{((?:(?!\*\/)[\s\S])*?)\} (\w+)/g;
      for (const m of body.matchAll(TYPEDEF)) {
        defined.add(m[2]);
        // **文字列リテラルを型名として拾わない。** `"ACTIVE" | "SUBSTITUTED"` の
        // ような並びは値であって型の参照ではない。**拾うと、定義が無いと言って
        // 落ちる。落ちる理由が嘘になる**（型検査を入れて判明。AUT-226）。
        const body2 = m[1].replace(/"[^"]*"/g, "").replace(/'[^']*'/g, "");
        for (const t of body2.matchAll(/\b([A-Z]\w+)\b/g)) used.add(t[1]);
      }
    }
  };
  walk(join(KIT, "src"));

  // 標準で入っているものは、定義を持たない。
  const builtin = new Set([
    "Record", "Partial", "Promise", "Array", "Map", "Set", "ReadonlyArray",
    "D1Database", "Response", "Request", "Date", "Error", "URL", "Buffer", "RegExp",
  ]);
  const missing = [...used].filter((t) => !defined.has(t) && !builtin.has(t));
  assert.deepEqual(missing, [], `定義の無い型が参照されている: ${missing.join(", ")}`);
  assert.ok(defined.size > 20, `型の説明が少なすぎる: ${defined.size} 個`);
});

// ------------------------------------------------ 配る一覧が、食い違っていないこと

/**
 * **一覧が2つある。** npm が配る範囲（`package.json` の `files`）と、プロジェクトへ
 * 複製する範囲（`init.js`）である。片方だけを足しても、どの判定も落ちなかった。
 *
 * `vendor` は複製元が無いものを黙って飛ばしていたため、**npx 経由でだけ中身の欠けた
 * 複製ができる**状態だった（AUT-202）。飛ばすのはやめたが、そちらは打ってみるまで
 * 分からない。**打つ前に、一覧どうしで突き合わせる。**
 */
test("複製するものが、npm が配る範囲から外れていない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  // `package.json` 自身は宣言せずとも npm が必ず入れる。
  const shipped = [...pkg.files, "package.json"];
  const covered = (path) => shipped.some((e) => path === e || path.startsWith(`${e}/`));

  for (const path of [VENDORED_ROOT, TEMPLATES_DIR, ...VENDORED_META]) {
    assert.ok(covered(path), `配るのに、npm の一覧に入っていない: ${path}`);
  }
});

// **配らないものが紛れ込んでいないこと。** 逆向きも見ないと、`files` に増やした
// ものが黙って配られる。
test("npm が配る範囲に、配らないものが入っていない", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  for (const unneeded of ["test", "docs", "telemetry", "mutations"]) {
    assert.equal(pkg.files.includes(unneeded), false, `${unneeded} を配っている`);
  }
});

// -------------------------------------------- 自分の CI が、実在するものを呼ぶこと

/**
 * **落ちたのはここだった。** 配布の境界を動かしたとき（AUT-202）、参照実装自身の
 * CI が消えたパス（`autodrive-dev-kit/invariants`）を呼んだまま残っていた。テストも
 * 変異の一覧も通り、**提出して CI を回すまで分からなかった。**
 *
 * 横断の判定は他のリポジトリをクローンしてから打つため、手元では再現できない。
 * **再現できないなら、せめて呼んでいる先が実在するかは見る。**
 */
test("自分の CI が呼ぶ autodrive-dev-kit のパスが、実在する", () => {
  const workflow = readFileSync(join(KIT, ".github", "workflows", "invariants.yml"), "utf8");

  // クローン先の名前を剥がして、リポジトリの中での位置にする。
  const called = [...workflow.matchAll(/autodrive-dev-kit\/([\w./-]+)/g)].map((m) => m[1]);
  assert.notEqual(called.length, 0, "呼び出しを1つも拾えていない。拾い方が壊れている");

  for (const path of new Set(called)) {
    assert.ok(statSync(join(KIT, path), { throwIfNoEntry: false }), `CI が呼ぶのに実在しない: ${path}`);
  }
});

// -------------------------------------------- 型検査が配線されていること（AUT-226）
//
// **JSDoc で型を書いているのに、誰も確かめていなかった。** 入れたところ、書いた型が
// 効いていない箇所が3つ出た（存在しない型を指していた／import せずに名前だけ書いて
// いた／実装がポートの約束と合っていなかった）。
//
// **型を文書として書くだけでは、文書が嘘をついていても分からない。**
test("型検査が、打てる形で配線されている", () => {
  const pkg = JSON.parse(readFileSync(join(KIT, "package.json"), "utf8"));
  assert.equal(pkg.scripts?.typecheck, "tsc --noEmit", "型検査の打ち方が無い");
  // **開発時の依存に限る**（ADR 0001 の改訂）。配られるものはゼロのまま。
  assert.equal(pkg.dependencies, undefined, "配られるものに依存が入っている");
  assert.ok(pkg.devDependencies?.typescript, "型検査の道具が無い");
});

// **CI で走ること。** 打てるだけでは、誰も打たない。
test("型検査が CI で走る", () => {
  const wf = readFileSync(join(KIT, ".github", "workflows", "invariants.yml"), "utf8");
  assert.match(wf, /run: npm run typecheck/, "CI が型検査を走らせていない");
  // **依存を取ってこないと走らない。**
  assert.match(wf, /run: npm ci/, "CI が依存を取っていない");
});

// **ロックファイルを追跡する。** 除外したまま依存を入れると、固定されないうえ
// **差分にも出ないので気づけない**（AUT-226）。
test("ロックファイルが追跡されている", () => {
  // **`--no-index` を付ける。** 付けないと、`check-ignore` は**追跡済みのファイルを
  // 「無視されない」と答える。** 除外の指定が戻っていても気づけない。手元では
  // 未追跡だったので一致し、CI ではコミット済みなので一致せず、**CI でだけ変異が
  // 生き残った**（AUT-226）。
  //
  // **`check-ignore` は一致しないと非ゼロで終わる。** 例外の有無で見る。
  let ignored = false;
  try {
    execFileSync("git", ["-C", KIT, "check-ignore", "--no-index", "package-lock.json"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    ignored = true;
  } catch {
    ignored = false;
  }
  assert.equal(ignored, false, "ロックファイルが除外されている");
  assert.ok(existsSync(join(KIT, "package-lock.json")), "ロックファイルが置かれていない");
  // **追跡されていること。** 置いてあるだけでは固定にならない。
  const tracked = execFileSync("git", ["-C", KIT, "ls-files", "package-lock.json"], {
    encoding: "utf8",
  }).trim();
  assert.equal(tracked, "package-lock.json", "ロックファイルが追跡されていない");
});
