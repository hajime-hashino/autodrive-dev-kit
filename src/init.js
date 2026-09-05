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
import {
  describeEdits,
  describeUnchecked,
  findEdits,
  manifestPath,
  readManifest,
  writeManifest,
} from "./manifest.js";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { allowedDomains } from "./sandbox.js";
import { envExample } from "./credentials.js";
import { say } from "./messages.js";
import { defaults } from "./config.js";


/** 複製先。**追跡する。** 版を固定するには、履歴に載っている必要がある。 */
export const VENDOR_DIR = "autodrive";

/** 複製するもの。テストや文書は要らない（プロジェクトは `init` を打たない）。 */
const VENDORED = ["src", "hooks", "bin", "invariants", "verify", "VERSION", "package.json"];
/** @typedef {"managed" | "seeded" | "skipped" | "merged"} Placement */
/** @typedef {{ path: string, placement: Placement }} Placed */
function write(full , body) {
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
}
/** @typedef {{ placed: Placed[], todo: string[], notes: string[], version: string | null, code: number, message: string | null }} InitResult */
/**
 * 管理下。上書きする。**ローカルの編集は参照実装への起票の契機である。**
 *
 * **ここでは書かない。溜めるだけにする。** 手で変えられているかを先に全部
 * 確かめてから書く。書きながら確かめると、**一部だけ新しい状態**ができる
 * （AUT-116）。
 */
function managed(path , body , plan) {
  plan.writes.push({ path, body });
  plan.placed.push({ path, placement: "managed" });
}

/** 播種。**既にあれば触らない。** 中身はプロジェクトのものになる。 */
function seeded(root , path , body , out) {
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
export function template(kitRoot , name , vars = {}) {
  let body = readFileSync(join(kitRoot, "templates", name), "utf8");
  body = body.replaceAll("{{KIT}}", VENDOR_DIR);
  for (const [key, value] of Object.entries(vars)) body = body.replaceAll(`{{${key}}}`, value);
  return body;
}

/**
 * 記録の仕掛けを登録する。
 *
 * **既にある登録を壊さない。** 設定は利用側のものであり、こちらの都合で
 * 上書きしてよいものではない。同じ登録が既にあれば何もしない。
 */
export function mergeHook(existing , command) {
  let settings = {};
  if (existing !== null && existing.trim() !== "") {
    try {
      settings = JSON.parse(existing);
    } catch {
      // **読めない設定を捨てない。** 呼び出し側が判断できるよう、変更なしで返す。
      return { json: existing, changed: false };
    }
  }

  const hooks = (settings.hooks ?? {});
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
export function vendor(root , kitRoot) {
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

/**
 * サンドボックスを置く。
 *
 * **記録しているのに置いていない状態を作らない。** 構成が `sandbox: none` なら
 * 置かない。それ以外なら置く。
 *
 * **許可する宛先は構成から組み立てる**（`sandbox.ts`）。使わないものへの穴を
 * 開けない。
 */
/**
 * いま隔離された作業場の中にいるか。
 *
 * **確かめられない場合は「外にいる」とする。** 中にいるのに言われるのは冗長なだけ
 * だが、外にいるのに言われないと、隔離されないまま動く。
 *
 * @returns {boolean}
 */
/**
 * 置き場所（Repo）が既にあるか。
 *
 * **無い状態を前提にする。** `init` は素のディレクトリで打たれる。置き場所を
 * 作る前に「シークレットを登録せよ」と言われても、登録する先が無い（AUT-99）。
 *
 * @param {string} root
 * @returns {boolean}
 */
export function hasRemote(root) {
  try {
    return execFileSync("git", ["-C", root, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() !== "";
  } catch {
    return false;
  }
}

export function insideSandbox() {
  return existsSync("/.dockerenv") || process.env.REMOTE_CONTAINERS === "true";
}

/**
 * 作業場に足す道具を、雛形へ差し込む形にする。
 *
 * **雛形を丸ごと組み直さない。** `devcontainer.json` は JSONC であり、コメントに
 * 判断の理由が書いてある。読んで書き戻すとコメントが消える（AUT-132）。`{{NAME}}`
 * と同じく差し込み口へ入れる。
 *
 * **なぜ要るのかを、置いた場所に残す。** 後から読む人が、消してよいかを判断できる。
 */
export function featuresBlock(config) {
  const features = config.app?.sandbox?.features ?? [];
  if (features.length === 0) return "";

  const lines = ["", "", "    // ここから下は、このプロジェクトが足したもの。", "    // autodrive.json の app.sandbox.features にある。"];
  features.forEach((f, i) => {
    lines.push(`    // ${f.why}`);
    const options = JSON.stringify(f.options ?? {});
    lines.push(`    ${JSON.stringify(f.id)}: ${options}${i < features.length - 1 ? "," : ""}`);
  });
  // 直前の項目の末尾に読点が要る。**差し込み口は最後の項目の直後にある。**
  return `,${lines.join("\n")}`;
}

function placeSandbox(root , kitRoot , config , plan) {
  if (config.ports.sandbox === "none") return false;

  const name = basename(root) || "project";
  // **報告だけ畳む。** 書くものは同じ一覧に入れないと、確かめる対象から漏れる。
  const folded = { placed: [], writes: plan.writes };
  for (const file of ["devcontainer.json", "init-firewall.sh", "post-create.sh", "check-setup.sh", "devcontainer-lock.json", "README.md"]) {
    managed(
      `.devcontainer/${file}`,
      template(kitRoot, `devcontainer/${file}`, { NAME: name, APP_FEATURES: featuresBlock(config) }),
      folded,
    );
  }
  // **一覧は構成から作る。** 雛形を写すと、使わないポートの宛先が付いてくる。
  managed(".devcontainer/allowed-domains.txt", allowedDomains(config), folded);

  // **1つにまとめて報告する。** 中の1つ1つを並べると、出力の大半が
  // サンドボックスで埋まり、何が置かれたのかが読みにくくなる。
  plan.placed.push({ path: ".devcontainer/", placement: "managed" });
  return true;
}

export function init(root , kitRoot , config = null, inside = insideSandbox()) {
  // **置くものと、置いた記録を一緒に運ぶ。** 管理下のものは溜めるだけにして、
  // 手で変えられていないかを確かめてから、まとめて書く。
  const plan = { placed: [], writes: [] };
  const placed = plan.placed;

  if (!existsSync(join(root, ".git"))) {
    return {
      placed,
      todo: [],
      version: null,
      code: 1,
      notes: [],
      message:
        "ここは git のリポジトリではない。\n" +
        "先に `git init` してから、もう一度実行すること。記録も判定も履歴の上で成り立っている。",
    };
  }

  // 管理下 --------------------------------------------------------------------
  // **構成から作る。** 雛形を写すと、使わないポートの資格情報を求めることになり、
  // 使うポートのものが抜けても気づけない。実際に GH_TOKEN が抜けていた（AUT-98）。
  managed(".env.example", envExample(config ?? defaults()), plan);
  managed(".github/workflows/invariants.yml", template(kitRoot, "invariants.yml"), plan);
  managed("docs/autodrive.md", template(kitRoot, "autodrive.md"), plan);

  // サンドボックス。**置くものを決めるだけ。書くのはこの後。**
  const sandboxPlaced = config !== null && placeSandbox(root, kitRoot, config, plan);

  // 手で変えられていないか ------------------------------------------------------
  //
  // **書く前に、全部を確かめる。** 見つかったら何も書かずに止まる。書きながら
  // 確かめると、一部だけ新しい状態ができる（AUT-116）。
  //
  // **道具一式を入れ替える前でもある。** 先に入れ替えると、止めたときに
  // 道具だけ新しく、管理下のファイルが古い状態が残る。
  const previous = readManifest(manifestPath(root, VENDOR_DIR));
  const { edited, unchecked } = findEdits(root, plan.writes, previous);
  if (edited.length > 0) {
    return { placed: [], todo: [], notes: [], version: null, code: 1, message: describeEdits(edited) };
  }

  // 道具一式 ------------------------------------------------------------------
  const version = vendor(root, kitRoot);
  placed.push({ path: `${VENDOR_DIR}/`, placement: "managed" });

  // 置く。**指紋も残す。** 残さないと、次に確かめられない。
  for (const w of plan.writes) write(join(root, w.path), w.body);
  writeManifest(manifestPath(root, VENDOR_DIR), plan.writes);

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
  // **README だけ置く。** 中身は追跡しないが、置き場所と、置いてはいけないものは
  // クローンした先にも残る必要がある。
  seeded(root, "notes/README.md", template(kitRoot, "notes/README.md"), placed);

  // **既にある規約を上書きしない。** ただし、繋がっていなければそう言う。
  const claude = join(root, "CLAUDE.md");
  const pointer =
    existsSync(claude) && !readFileSync(claude, "utf8").includes("docs/autodrive.md")
      ? say(config?.language ?? "ja", "todo.pointer")
      : null;
  seeded(root, "CLAUDE.md", template(kitRoot, "CLAUDE.md"), placed);

  // 人にしかできないこと --------------------------------------------------------
  //
  // **済んでいることを頼まない。** 毎回同じ一覧を出すと、読まれなくなる。読まれ
  // なくなった一覧は、本当に要るものが出たときにも読まれない。
  const todo = [];
  const t = (key) => say(config?.language ?? "ja", key);

  // **AIにできることを、ここに書かない。** この一覧は Claude Code を開く前に
  // 読まれるため、書いたものはすべて人の作業になる。置き場所の作成もシークレットの
  // 登録も API の呼び出しであり、AIが動き始めてから行えばよい（AUT-100）。
  //
  // 残すのは、AIに実行できないものだけである。
  //
  //   資格情報の発行    外部サービスでの操作
  //   作業場を開き直す  そこにAIがまだ動いていない。立ち上げそのもの
  if (!existsSync(join(root, ".env"))) {
    todo.push(t("todo.env"));
  }
  // **置いたものを使えと言う。** 開き直さなければ、隔離されていない場所でAIが
  // 動く。構成は隔離すると記録しているのに、実際には隔離されない。
  //
  // **`.env` の後に言う。** 支度は環境を作るときに `.env` を読む。先に開き直すと、
  // 資格情報が入らないまま作業場ができる。
  //
  // **既に中にいるなら言わない。** 済んでいることを頼まない。
  if (sandboxPlaced && !inside) {
    todo.push(t("todo.reopen"));
  }

  if (pointer !== null) todo.push(pointer);

  // **前の版が置いた CI 定義を、黙って消さない。** 判定は `invariants` に改名した
  // が（AUT-83）、古い `verify.yml` が残ると同じ判定が二重に走る。手を入れられて
  // いる可能性があるため、消すのは人に任せ、残っている事実だけを出す。
  const stale = join(root, ".github", "workflows", "verify.yml");
  if (existsSync(stale) && readFileSync(stale, "utf8").includes(`${VENDOR_DIR}/verify`)) {
    todo.push(t("todo.staleWorkflow"));
  }
  // **覚えることを増やさない。** どこから始めるかはAIが状態を見て決める（AUT-80）。
  todo.push(t("todo.start"));

  // **確かめられなかったことは黙らない。** 黙ると、確かめた顔になる。
  const notes = unchecked.length > 0 ? [describeUnchecked(unchecked)] : [];

  return { placed, todo, notes, version, code: 0, message: null };
}
