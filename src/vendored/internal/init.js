/**
 * 対象プロジェクトに、autodrive-dev-kit を置く。
 *
 * **人が打つのはこれだけである。** 着手も記録も判定もAIが行う。人に手順を打たせる
 * 形にすると、人の関与を減らすという目的と噛み合わない。
 *
 * **autodrive-dev-kit はプロジェクトの中へ複製する。** 手元の参照実装を指す形にすると、参照実装を
 * 更新した瞬間に、全てのプロジェクトが同時に変わる。プロジェクトごとに違うバージョンで
 * 動けることが要る。記録に付く `kit_version` も、複製した時点のバージョンになる。
 *
 * 置くものは3つに分かれる（BOOTSTRAP 段階5）。
 *
 *   管理下  autodrive-dev-kit、CI定義、AI向けの規約、.env のテンプレート   → 上書きする
 *   播種    委譲範囲の表の初期状態、What/Why のテンプレート            → **既にあれば触らない**
 *   固有    テスト、ADR、委譲範囲の変更履歴                     → 生成しない
 *
 * **何度実行しても壊れないこと。** 途中で失敗したときに、やり直せる必要がある。
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  describeEdits,
  describeUnchecked,
  findEdits,
  linesLost,
  manifestPath,
  readManifest,
  writeManifest,
} from "./manifest.js";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { allowedDomains } from "./sandbox.js";
import { envExample } from "./credentials.js";
import { say } from "./messages.js";
import { defaults, retired } from "./config.js";


/** 複製先。**追跡する。** バージョンを固定するには、履歴に載っている必要がある。 */
export const VENDOR_DIR = "autodrive";

/**
 * 複製の中身。**この中だけが、まるごと `autodrive/` になる。**
 *
 * 以前は複製するものを1件ずつ並べていた（`src` / `hooks` / `bin` / `invariants` …）。
 * **その一覧は、参照実装のトップ階層と同じ高さに並んでいた。** 配るものと配らない
 * ものが見た目で区別できず、一覧を足し忘れても気づく機会が無かった（AUT-202）。
 *
 * いまは階層が境界である。**ここに入れれば配られ、外に出せば配られない。**
 */
export const VENDORED_ROOT = "src/vendored";

/**
 * 複製に添えるもの。名前のまま `autodrive/` の直下へ置く。
 *
 * **ライセンスは要る。** ここに置くのはこの autodrive-dev-kit のコードの複製であり、Apache-2.0 は
 * 「複製を受け取る人にライセンスの写しを渡す」ことを求めている（§4(a)）。入れないと、
 * **採用先にライセンス文の無いコードの複製が残る。** NOTICE も同じ理由で入れる
 * （§4(d)）。誰のものか分からない複製にしない。
 *
 * **`src/vendored/` の中へ入れていない。** npm も Apache-2.0 も、これらがリポジトリの
 * 直下にあることを前提にしている。`package.json` に至っては動かせない。
 */
export const VENDORED_META = ["VERSION", "package.json", "LICENSE", "NOTICE"];

/**
 * テンプレートの置き場所。
 *
 * **配られるが、複製はされない。** `init` と `update` がここからプロジェクトの
 * ファイルを作る。プロジェクトは `init` を打たないので、複製には要らない
 * （[ADR 0004](../../../docs/adr/0004-vendored-kit.md)）。
 *
 * **npm の境界と複製の境界は違う。** `src/vendored/` の外に置いているのは、その
 * 違いを階層に出すためである。中へ入れると「複製から templates を除く」という
 * 除外の一覧が要り、AUT-202 で消した一覧が形を変えて戻る。
 */
export const TEMPLATES_DIR = "src/templates";
/** @typedef {"managed" | "seeded" | "skipped" | "merged"} Placement */
/** @typedef {{ path: string, placement: Placement }} Placed */
function write(full , body) {
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, "utf8");
}
/** @typedef {{ placed: Placed[], todo: string[], notes: string[], version: string | null, code: number, message: string | null }} InitResult */
/**
 * 管理下。上書きする。**ローカルの編集は、参照実装へ起票する理由になる。**
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
 * テンプレートを読む。`{{KIT}}` は複製先に置き換える。
 *
 * **テンプレートをコードの中に文字列で持たない。** ファイルにしておくと、アプリの種別や
 * エージェントの種別ごとに差し替えるとき、置き場所を変えるだけで済む。
 */
export function template(kitRoot , name , vars = {}) {
  let body = readFileSync(join(kitRoot, TEMPLATES_DIR, name), "utf8");
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
 * autodrive-dev-kit を複製する。
 *
 * **入れ替えではなく置き換えにする。** 前のバージョンの残骸が混ざると、どのバージョンで動いて
 * いるのかが読めなくなる。複製先はまるごと捨ててから置く。
 */
/**
 * 1ファイルずつ複製する。
 *
 * **`cpSync` の再帰に頼らない。** virtiofs（macOS + Lima のサンドボックス）では
 * ディレクトリごとの再帰複製が `EACCES` で落ちる。1ファイルずつなら通る
 * （AUT-131）。
 *
 * **実行権もコピーする。** `copyFileSync` は中身しか写さない。`bin/autodrive-dev-kit`・
 * `invariants`・`verify`・`hooks/*` は実行ファイルであり、権が落ちると打てなくなる。
 */
function copyInto(from , to) {
  const info = statSync(from);
  if (info.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const name of readdirSync(from)) copyInto(join(from, name), join(to, name));
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  chmodSync(to, info.mode);
}

/**
 * autodrive-dev-kit を複製する。
 *
 * **置いてから消す。** 以前は消してから置いていたため、複製の途中で落ちると
 * **古いバージョンも新しいバージョンも無い状態が残った。** 実際に、autodrive-dev-kit が消えて `invariants` も
 * 打てなくなった（AUT-131）。git から戻すしかない失敗になっていた。
 *
 * いまは別の場所へ組み立て、**出来上がってから入れ替える。** 途中で落ちても、
 * 古いバージョンはそのまま残る。
 */
export function vendor(root , kitRoot) {
  const dest = join(root, VENDOR_DIR);
  const staging = `${dest}.new`;
  const previous = `${dest}.old`;

  // 前回の失敗の残骸を片付ける。**入れ替えの対象ではない場所だけを消す。**
  rmSync(staging, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });

  try {
    mkdirSync(staging, { recursive: true });

    // **複製の中身は、名前を持たずに直下へ展開する。** そのため殻から実装への
    // 相対パスが、参照実装の中と複製先とで同じになる。
    const inside = join(kitRoot, VENDORED_ROOT);
    for (const name of readdirSync(inside)) copyInto(join(inside, name), join(staging, name));

    // **無いものを飛ばさない。** 以前は黙って飛ばしていたため、配る一覧に足して
    // npm の一覧に足し忘れると、**中身の欠けた複製ができて何も落ちなかった**
    // （AUT-202）。欠けたまま動くより、ここで止まるほうがよい。
    for (const name of VENDORED_META) {
      const from = join(kitRoot, name);
      if (!existsSync(from)) throw new Error(`複製に要るものが無い: ${name}`);
      copyInto(from, join(staging, name));
    }
  } catch (error) {
    // **古いバージョンを消さずに戻る。** 打てなくなるより、古いままのほうがよい。
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  // 入れ替え。**名前の付け替えだけで行う。** 同じ場所にあるため、途中に
  // 「どちらも無い」瞬間ができない。
  if (existsSync(dest)) renameSync(dest, previous);
  renameSync(staging, dest);
  rmSync(previous, { recursive: true, force: true });

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
 * いま隔離されたサンドボックスの中にいるか。
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
 * サンドボックスのうち、プロジェクトが持つもの。
 *
 * **kit はロジックを持ち、プロジェクトは設定を持つ。**
 *
 *   init-firewall.sh / post-create.sh / check-setup.sh   kit    隔離のロジック
 *   allowed-domains.txt                                  kit    構成から作る
 *   devcontainer.json                                    ここ   コンテナの設定
 *   devcontainer-lock.json                               ここ   CLI が書く記録
 *
 * ## なぜ devcontainer.json を渡すか
 *
 * `forwardPorts`・`mounts`・`containerEnv`・拡張——**触りたい項目が多い。** 管理下に
 * 置くと、項目ごとに構成へ差し込み口を足していくことになり、kit が Dev Container
 * 仕様の写しになる。プロジェクト側はその間ずっと止まる（AUT-157）。
 *
 * ## 渡しても隔離が守られる理由
 *
 * **守っていたのは管理下であることではない。** AUT-121 では、このファイルが
 * テンプレートと1バイトも違わないまま10日間隔離が外れていた。壊れていたのは
 * テンプレート自身であり、指紋は何も捕まえていない。
 *
 * 実際に守っているのは2つある。
 *
 *   init-firewall.sh   起動のたびに走り、実際の到達可否を両方向で確かめる
 *   isolation.js       その設定があるかを判定する。CI で落ちる
 *
 * ## なぜ lock も同じ扱いか
 *
 * 他の管理下ファイルは `(テンプレート, 構成)` だけで中身が決まる。**lock は違う。**
 * サンドボックスを作り直すたびに Dev Containers CLI が解決したバージョンを書き込むため、
 * 管理下に置くと毎回「手で変えられている」と誤判定され、`update` が止まる
 * （AUT-153）。**人は誰も触っていないのに。**
 */
const PROJECT_OWNED_SANDBOX = ["devcontainer.json", "devcontainer-lock.json"];

/**
 * 前に置いたが、今回は置かないもの。**まだ残っているものだけ。**
 *
 * @param {string} root
 * @param {Record<string, string> | null} previous 前に置いたときの指紋
 * @param {Array<{ path: string }>} writes 今回置くもの
 * @returns {string[]}
 */
export function leftBehind(root, previous, writes) {
  if (previous === null) return [];
  const now = new Set(writes.map((w) => w.path));
  return Object.keys(previous)
    .filter((p) => !now.has(p) && existsSync(join(root, p)))
    .sort();
}

/**
 * プロジェクトが持つサンドボックスのファイルを置く。
 *
 * **最初の一度だけ置き、以後は触らない。** 既にあれば、テンプレートが変わって
 * いても書き換えない。代わりに、変わっていることを言う（`driftNotes`）。
 */
function seedSandbox(root , kitRoot , placed) {
  const name = basename(root) || "project";
  for (const file of PROJECT_OWNED_SANDBOX) {
    seeded(root, `.devcontainer/${file}`, template(kitRoot, `devcontainer/${file}`, { NAME: name }), placed);
  }
}

/**
 * プロジェクトが持つファイルが、テンプレートから離れていないか。
 *
 * **書き換えない。言うだけである。** 持ち主はプロジェクトであり、こちらが決める
 * ことではない。ただし**黙っていると、静かに古くなる。** kit 側の改善が入った
 * ことを知る機会が無くなる。
 *
 * **消える行ではなく、増える行を出す。** 知りたいのは「テンプレートには有るが、
 * こちらには無いもの」である。
 */
function driftNotes(root , kitRoot ) {
  const notes = [];
  const name = basename(root) || "project";

  for (const file of PROJECT_OWNED_SANDBOX) {
    const path = join(root, ".devcontainer", file);
    if (!existsSync(path)) continue;

    // **lock は比べない。** CLI が書き換えるのが正常であり、離れているのが既定の
    // 状態になる。毎回言うと、読まれなくなる（AUT-153）。
    if (file === "devcontainer-lock.json") continue;

    let current;
    try {
      current = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const latest = template(kitRoot, `devcontainer/${file}`, { NAME: name });
    if (current === latest) continue;

    const added = linesLost(latest, current);
    if (added.length === 0) continue;

    notes.push(
      [
        `\`.devcontainer/${file}\` は、このプロジェクトのものである。**書き換えていない。**`,
        "",
        "kit のテンプレート側に、こちらに無い行がある。取り込むかは見て決めること。",
        "",
        ...added.slice(0, 8).map((l) => `  ${l}`),
        ...(added.length > 8 ? [`  … 他 ${added.length - 8} 行`] : []),
      ].join("\n"),
    );
  }
  return notes;
}

function placeSandbox(root , kitRoot , config , plan) {
  // **devcontainer を選んだときだけ置く。**
  //
  // 以前は `none` 以外すべてに置いていた。**選んだものと置かれるものが食い違う。**
  // Orca を使うプロジェクトに devcontainer 一式が降ってきて、どちらが本物か
  // 分からなくなる。**置いたものは判定の対象にもなる**ため、使っていない設定の
  // 欠けで落ちる（AUT-218）。
  //
  // 他のサンドボックスは、用意するのがプロジェクトである。ADR 0012。
  if (config.ports.sandbox !== "devcontainer") return false;

  // **報告だけ畳む。** 書くものは同じ一覧に入れないと、確かめる対象から漏れる。
  /** @type {{ placed: Placed[], writes: Array<{ path: string, body: string }> }} */
  const folded = { placed: [], writes: plan.writes };
  for (const file of ["init-firewall.sh", "post-create.sh", "check-setup.sh", "README.md"]) {
    managed(`.devcontainer/${file}`, template(kitRoot, `devcontainer/${file}`), folded);
  }
  // **一覧は構成から作る。** テンプレートを写すと、使わないポートの宛先が付いてくる。
  managed(".devcontainer/allowed-domains.txt", allowedDomains(config), folded);

  // **1つにまとめて報告する。** 中の1つ1つを並べると、出力の大半が
  // サンドボックスで埋まり、何が置かれたのかが読みにくくなる。
  plan.placed.push({ path: ".devcontainer/", placement: "managed" });
  return true;
}

/**
 * @param {string} root
 * @param {string} kitRoot
 * @param {import("./config.js").Config | null} config
 * @param {boolean} inside
 * @returns {InitResult}
 */
export function init(root , kitRoot , config = null, inside = insideSandbox()) {
  // **置くものと、置いた記録を一緒に運ぶ。** 管理下のものは溜めるだけにして、
  // 手で変えられていないかを確かめてから、まとめて書く。
  // **空の配列に型を書かないと `never[]` と推論される。** 入れたものを後から
  // 読めない（型検査を入れて判明。AUT-226）。
  /** @type {{ placed: Placed[], writes: Array<{ path: string, body: string }> }} */
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
  // **構成から作る。** テンプレートを写すと、使わないポートの資格情報を求めることになり、
  // 使うポートのものが抜けても気づけない。実際に GH_TOKEN が抜けていた（AUT-98）。
  managed(".env.example", envExample(config ?? defaults()), plan);
  managed(".github/workflows/invariants.yml", template(kitRoot, "invariants.yml"), plan);
  managed("docs/autodrive.md", template(kitRoot, "autodrive.md"), plan);
  // **毎回読むものと、引くものを分けている。** 毎回読ませる量が、そのまま作業に
  // 使える余地を削る。守ることは autodrive.md に短く書き、なぜ・どう測るか・
  // 過去に何が起きたかはこちらに置く（AUT-196）。
  managed("docs/autodrive-reference.md", template(kitRoot, "autodrive-reference.md"), plan);

  // サンドボックス。**置くものを決めるだけ。書くのはこの後。**
  const sandboxPlaced = config !== null && placeSandbox(root, kitRoot, config, plan);

  // 手で変えられていないか ------------------------------------------------------
  //
  // **書く前に、全部を確かめる。** 見つかったら何も書かずに止まる。書きながら
  // 確かめると、一部だけ新しい状態ができる（AUT-116）。
  //
  // **autodrive-dev-kit を入れ替える前でもある。** 先に入れ替えると、止めたときに
  // autodrive-dev-kit だけ新しく、管理下のファイルが古い状態が残る。
  const previous = readManifest(manifestPath(root, VENDOR_DIR));
  const { edited, unchecked } = findEdits(root, plan.writes, previous);
  if (edited.length > 0) {
    return { placed: [], todo: [], notes: [], version: null, code: 1, message: describeEdits(edited) };
  }

  // autodrive-dev-kit ------------------------------------------------------------------
  const version = vendor(root, kitRoot);
  placed.push({ path: `${VENDOR_DIR}/`, placement: "managed" });

  // 置く。**指紋も残す。** 残さないと、次に確かめられない。
  for (const w of plan.writes) write(join(root, w.path), w.body);
  writeManifest(manifestPath(root, VENDOR_DIR), plan.writes, config?.ports ?? null);

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
  //
  // **`.devcontainer/` の中でも、これだけ管理下から外れる。** Dev Containers CLI が
  // 作り直しのたびに書き込むため、`(テンプレート, 構成)` だけでは中身が決まらない
  // （AUT-153）。最初の一度だけ置き、以後はプロジェクトの実測値として扱う。
  if (sandboxPlaced) seedSandbox(root, kitRoot, placed);

  seeded(root, "boundaries.yaml", template(kitRoot, "boundaries.yaml"), placed);
  seeded(root, "docs/what-why.md", template(kitRoot, "what-why.md"), placed);
  // **品質で守ることは、会話ではなくファイルに残す。** 立ち上げで決めても、
  // 置き場が無ければ次の作業単位では読めない（AUT-210）。
  seeded(root, "docs/quality.md", template(kitRoot, "quality.md"), placed);
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
  //   サンドボックスを開き直す  そこにAIがまだ動いていない。立ち上げそのもの
  if (!existsSync(join(root, ".env"))) {
    todo.push(t("todo.env"));
  }
  // **置いたものを使えと言う。** 開き直さなければ、隔離されていない場所でAIが
  // 動く。構成は隔離すると記録しているのに、実際には隔離されない。
  //
  // **`.env` の後に言う。** 支度は環境を作るときに `.env` を読む。先に開き直すと、
  // 資格情報が入らないままサンドボックスができる。
  //
  // **既に中にいるなら言わない。** 済んでいることを頼まない。
  if (sandboxPlaced && !inside) {
    todo.push(t("todo.reopen"));
  }

  // **完了させる仕組みは、ここでは配れない。** Tracker と Repo の連携が動かす
  // （ADR 0007）。ファイルは置けるが、**外部サービスの設定画面は押せない。**
  //
  // **実装名で書く。** 人が実際に開く画面の名前だからである（AUT-163）。構成に
  // 記録された実装を差し込むため、差し替えても案内が古くならない。
  if (config !== null && config !== undefined) {
    todo.push(
      say(config.language ?? "ja", "todo.trackerLink", {
        tracker: config.ports.tracker,
        repo: config.ports.repo,
      }),
    );
  }

  if (pointer !== null) todo.push(pointer);

  // **前のバージョンが置いた CI 定義を、黙って消さない。** 判定は `invariants` に改名した
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

  // **置かなくなったものを、黙って残さない。** ポートを変えると、前の構成で置いた
  // ものが管理下から外れる（sandbox を devcontainer から外すと `.devcontainer/` が
  // 残る）。指紋からも消えるため、次からは誰のものか分からなくなる（AUT-248）。
  //
  // **消しはしない。** 播種したもの（`devcontainer.json` など）が手で直されている
  // ことがある。管理下のものだけ消すと、半端な一式が残る。
  const left = leftBehind(root, previous, plan.writes);
  if (left.length > 0) {
    notes.push(
      say(config?.language ?? "ja", "note.leftBehind", { paths: left.map((p) => `  ${p}`).join("\n") }),
    );
  }

  // **持ち主がこちらでないものは、書き換えずに言う。** 黙っていると静かに古くなる。
  if (sandboxPlaced) notes.push(...driftNotes(root, kitRoot));

  // **読まなくなった項目が残っていたら、そう言う。** 書いてあるのに効かない状態は、
  // 書いた人から見て「効いているのに動かない」に見える。
  for (const r of retired(root)) {
    notes.push(`\`${r.key}\` は、もう読んでいない。\n\n${r.why}`);
  }

  return { placed, todo, notes, version, code: 0, message: null };
}
