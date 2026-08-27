/**
 * 対象プロジェクトに、道具一式を置く。
 *
 * **人が打つのはこれだけである。** 着手も記録も判定もAIが行う。人に手順を打たせる
 * 形にすると、人の関与を減らすという目的と噛み合わない。
 *
 * **道具はプロジェクトの中へ複製する。** 手元の参照実装を指す形にすると、参照実装を
 * 更新した瞬間に、全てのプロジェクトが同時に変わる。プロジェクトごとに違う版で
 * 動けることが要る。記録に付く `kit_version` も、複製した時点の版になる。
 *
 * 置くものは3つに分かれる（BOOTSTRAP 段階5）。
 *
 *   管理下  道具一式、CI定義、AI向けの規約、.env の雛形   → 上書きする
 *   播種    境界表の初期状態、What/Why の雛形            → **既にあれば触らない**
 *   固有    テスト、ADR、境界変更履歴                     → 生成しない
 *
 * **何度実行しても壊れないこと。** 途中で失敗したときに、やり直せる必要がある。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 複製先。**追跡する。** 版を固定するには、履歴に載っている必要がある。 */
export const VENDOR_DIR = "autodrive";

/** 複製するもの。テストや文書は要らない（プロジェクトは `init` を打たない）。 */
const VENDORED = ["src", "hooks", "bin", "verify", "VERSION", "package.json"];

export type Placement = "managed" | "seeded" | "skipped" | "merged";

export interface Placed {
  path: string;
  placement: Placement;
}

export interface InitResult {
  placed: Placed[];
  todo: string[];
  version: string | null;
  code: number;
  message: string | null;
}

function write(full: string, body: string): void {
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
}

/** 管理下。上書きする。**ローカルの編集は参照実装への起票の契機である。** */
function managed(root: string, path: string, body: string, out: Placed[]): void {
  write(join(root, path), body);
  out.push({ path, placement: "managed" });
}

/** 播種。**既にあれば触らない。** 中身はプロジェクトのものになる。 */
function seeded(root: string, path: string, body: string, out: Placed[]): void {
  if (existsSync(join(root, path))) {
    out.push({ path, placement: "skipped" });
    return;
  }
  write(join(root, path), body);
  out.push({ path, placement: "seeded" });
}

/**
 * 雛形を読む。`{{KIT}}` は複製先に置き換える。
 *
 * **雛形をコードの中に文字列で持たない。** ファイルにしておくと、アプリの種別や
 * エージェントの種別ごとに差し替えるとき、置き場所を変えるだけで済む。
 */
export function template(kitRoot: string, name: string): string {
  const body = readFileSync(join(kitRoot, "templates", name), "utf8");
  return body.replaceAll("{{KIT}}", VENDOR_DIR);
}

/**
 * 記録の仕掛けを登録する。
 *
 * **既にある登録を壊さない。** 設定は利用側のものであり、こちらの都合で
 * 上書きしてよいものではない。同じ登録が既にあれば何もしない。
 */
export function mergeHook(existing: string | null, command: string): { json: string; changed: boolean } {
  let settings: { hooks?: Record<string, unknown[]> } = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      settings = JSON.parse(existing) as typeof settings;
    } catch {
      // **読めない設定を捨てない。** 呼び出し側が判断できるよう、変更なしで返す。
      return { json: existing, changed: false };
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;
  const stop = Array.isArray(hooks.Stop) ? hooks.Stop : [];
  if (JSON.stringify(stop).includes(command)) return { json: existing ?? "", changed: false };

  hooks.Stop = [...stop, { hooks: [{ type: "command", command }] }];
  settings.hooks = hooks;
  return { json: `${JSON.stringify(settings, null, 2)}\n`, changed: true };
}

/**
 * 道具一式を複製する。
 *
 * **入れ替えではなく置き換えにする。** 前の版の残骸が混ざると、どの版で動いて
 * いるのかが読めなくなる。複製先はまるごと捨ててから置く。
 */
export function vendor(root: string, kitRoot: string): string {
  const dest = join(root, VENDOR_DIR);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  for (const name of VENDORED) {
    const from = join(kitRoot, name);
    if (!existsSync(from)) continue;
    cpSync(from, join(dest, name), { recursive: true });
  }

  const versionFile = join(dest, "VERSION");
  return existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "不明";
}

export function init(root: string, kitRoot: string): InitResult {
  const placed: Placed[] = [];

  if (!existsSync(join(root, ".git"))) {
    return {
      placed,
      todo: [],
      version: null,
      code: 1,
      message:
        "ここは git のリポジトリではない。\n" +
        "先に `git init` してから、もう一度実行すること。記録も判定も履歴の上で成り立っている。",
    };
  }

  // 道具一式 ------------------------------------------------------------------
  const version = vendor(root, kitRoot);
  placed.push({ path: `${VENDOR_DIR}/`, placement: "managed" });

  // 管理下 --------------------------------------------------------------------
  managed(root, ".env.example", template(kitRoot, ".env.example"), placed);
  managed(root, ".github/workflows/verify.yml", template(kitRoot, "verify.yml"), placed);
  managed(root, "docs/autodrive.md", template(kitRoot, "autodrive.md"), placed);

  // 記録の仕掛け。**利用側の設定へ併合する。**
  const settingsPath = join(root, ".claude", "settings.json");
  const before = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : null;
  const { json, changed } = mergeHook(before, `${VENDOR_DIR}/hooks/record-tokens`);
  if (changed) {
    write(settingsPath, json);
    placed.push({ path: ".claude/settings.json", placement: "merged" });
  } else {
    placed.push({ path: ".claude/settings.json", placement: "skipped" });
  }

  // 播種 ----------------------------------------------------------------------
  seeded(root, "boundaries.yaml", template(kitRoot, "boundaries.yaml"), placed);
  seeded(root, "docs/what-why.md", template(kitRoot, "what-why.md"), placed);
  seeded(root, ".gitignore", template(kitRoot, "gitignore"), placed);

  // **既にある規約を上書きしない。** ただし、繋がっていなければそう言う。
  const claude = join(root, "CLAUDE.md");
  const pointer =
    existsSync(claude) && !readFileSync(claude, "utf8").includes("docs/autodrive.md")
      ? "CLAUDE.md に次の1行を足すこと: 「作業の進め方は docs/autodrive.md に従う」"
      : null;
  seeded(root, "CLAUDE.md", template(kitRoot, "CLAUDE.md"), placed);

  // 人にしかできないこと --------------------------------------------------------
  //
  // **済んでいることを頼まない。** 毎回同じ一覧を出すと、読まれなくなる。読まれ
  // なくなった一覧は、本当に要るものが出たときにも読まれない。
  const todo: string[] = [];
  if (!existsSync(join(root, ".env"))) {
    todo.push(".env を作り、資格情報を書く（.env.example に必要なものが並んでいる）");
    todo.push("Repo の Actions シークレットに AUTODRIVE_CI_TOKEN を登録する（提出の読取を含めること）");
  }
  if (pointer !== null) todo.push(pointer);
  // **覚えることを増やさない。** どこから始めるかはAIが状態を見て決める（AUT-80）。
  todo.push("Claude Code を開き、「はじめる」と伝える。あとはAIが聞き始める");

  return { placed, todo, version, code: 0, message: null };
}
