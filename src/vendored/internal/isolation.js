/**
 * 隔離の設定が保たれているか。
 *
 * ## なぜ作ったか
 *
 * `.devcontainer/devcontainer.json` をプロジェクトのものにしたため（AUT-157）。
 * 触ってよいファイルにするなら、**壊れたことに気づける手段が要る。**
 *
 * ## なぜ「触らせない」ではないか
 *
 * 以前は kit の管理下に置き、指紋が合わなければ `update` を止めていた。**それは
 * 隔離を守っていなかった。**
 *
 * AUT-121 で実際に起きたこと。
 *
 * ```
 * サンドボックスの作成   2026-08-23
 * コンテナ起動   2026-09-02        ← 10日後。再起動している
 * iptables -S    -P OUTPUT ACCEPT  ← 既定が許可。規則0件
 * example.com    HTTP 200          ← 許可一覧に無い。素通り
 * ```
 *
 * **この10日間、`devcontainer.json` はテンプレートと1バイトも違わなかった。**
 * 壊れていたのはテンプレート自身であり、指紋は何も捕まえていない。
 *
 * 防止は、防げていない事故を防げているように見せる。定義§1が置き換えると言って
 * いるのは、**検出を人のレビューから自動検証へ**移すことである。
 *
 * ## 何を見るか
 *
 * **実際の到達可否は `init-firewall.sh` が見る。** あれは起動のたびに走り、許可した
 * 宛先へ出られるか・許可していない宛先へ出られないかを両方向で確かめ、失敗すれば
 * 終了コード1で落ちる（AUT-121）。設定の文字列より強い。
 *
 * **ここが見るのは、その自己検証が走る設定があるか、だけである。** 呼び出しごと
 * 外されると、自己検証も走らないため誰も気づけない。そこがちょうど穴になっている。
 *
 * ## 不変条件ではない
 *
 * 定義§9の不変条件は4つで固定であり、**5つ目を足すのは定義の変更**である
 * （AUT-121 が同じ判断をしている）。これは配布物「守ること」の検出手段であり、
 * 追跡してはいけないものの判定（`tracked.js`、AUT-137）と同じ位置に置く。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** サンドボックスの定義。 */
const DEFINITION = ".devcontainer/devcontainer.json";

/** 出口を閉じる処理。**起動のたびに走る必要がある。** */
const FIREWALL = "init-firewall.sh";

/** 出口を閉じるのに要る権限。 */
const CAPABILITIES = ["NET_ADMIN", "NET_RAW"];

/**
 * JSONC を読む。
 *
 * **行まるごとのコメントだけを落とす。** 行の途中から落とすと、`https://` の
 * `//` を拾ってURLを壊す。テンプレートのコメントは行の先頭にある。
 *
 * @returns {{ json: DevcontainerJson | null, error: string | null }}
 */
export function readDefinition(text) {
  const stripped = text.replace(/^\s*\/\/.*$/gm, "");
  try {
    /** @type {DevcontainerJson | null} */
    const json = JSON.parse(stripped);
    if (json === null || typeof json !== "object") return { json: null, error: "中身が項目になっていない" };
    return { json, error: null };
  } catch (e) {
    return { json: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * サンドボックスの定義のうち、判定が読むところ。
 *
 * **`object` と書かないこと。** どの項目も引けない型になる（型検査を入れて判明。
 * AUT-226）。**ここに並ぶのが、判定が見ている項目のすべてである。**
 *
 * @typedef {{
 *   postStartCommand?: unknown,
 *   postCreateCommand?: unknown,
 *   runArgs?: unknown,
 *   remoteUser?: unknown,
 * }} DevcontainerJson
 */

/** 呼び出しの中に、その名前が出てくるか。**配列でも文字列でも受ける。** */
function invokes(command, name) {
  if (typeof command === "string") return command.includes(name);
  if (Array.isArray(command)) return command.some((c) => invokes(c, name));
  if (command !== null && typeof command === "object") {
    return Object.values(command).some((c) => invokes(c, name));
  }
  return false;
}

/**
 * 隔離の設定に空いた穴を返す。
 *
 * **サンドボックスを使っていないプロジェクトは、何も返さない。** 定義が無ければ、
 * 見るものが無い。
 *
 * @param {string} root リポジトリの場所
 * @returns {Array<{ path: string, gap: string, why: string }>}
 */
export function isolationGaps(root) {
  const path = join(root, DEFINITION);
  if (!existsSync(path)) return [];

  const gaps = [];
  const add = (gap, why) => gaps.push({ path: DEFINITION, gap, why });

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    add("読めない", "中身を確かめられない。**確かめられないものを、通さない**");
    return gaps;
  }

  const { json, error } = readDefinition(text);
  if (json === null) {
    // **黙って通さない。** 読めないことは、正しいことではない。
    add("読めない", `${error}。中身を確かめられない`);
    return gaps;
  }

  // 1. 出口を閉じる処理が、起動のたびに走るか。
  //
  // **postCreateCommand では足りない。** iptables の規則はコンテナのネットワーク
  // 名前空間にあるため停止すると消えるが、あれは作ったときにしか走らない
  // （AUT-121）。
  if (!invokes(json.postStartCommand, FIREWALL)) {
    add(
      `postStartCommand が ${FIREWALL} を呼んでいない`,
      invokes(json.postCreateCommand, FIREWALL)
        ? "**postCreateCommand は作ったときにしか走らない。** 2回目以降の起動で隔離が無くなる（AUT-121）"
        : "出口を閉じる処理が走らない。**許可一覧に無い宛先へ素通りする**",
    );
  }

  // 2. 出口を閉じるのに要る権限があるか。
  const runArgs = Array.isArray(json.runArgs) ? json.runArgs.join(" ") : "";
  for (const cap of CAPABILITIES) {
    if (!runArgs.includes(cap)) {
      add(`runArgs に ${cap} が無い`, "iptables の規則を置けない。**出口を閉じられない**");
    }
  }

  // 3. root で動かしていないか。
  //
  // **出口を閉じる処理だけが sudo で走る。** エージェント自身が root だと、
  // 置いた規則をそのまま外せる。
  if (json.remoteUser === undefined || json.remoteUser === "root") {
    add(
      "remoteUser が root（または指定が無い）",
      "エージェントが root で動くと、**置いた規則を自分で外せる**",
    );
  }

  // 4. 呼んでいるスクリプトが、実際にあるか。
  //
  // **指しているだけで、置かれていない状態を作らない。** 起動のたびに失敗するが、
  // 失敗が見られるとは限らない。
  for (const script of [FIREWALL, "post-create.sh"]) {
    const referenced =
      invokes(json.postStartCommand, script) || invokes(json.postCreateCommand, script);
    if (referenced && !existsSync(join(root, ".devcontainer", script))) {
      add(`${script} を呼んでいるが、置かれていない`, "起動のたびに失敗する");
    }
  }

  return gaps;
}

/**
 * 見つかったものを人に伝える。
 *
 * **直し方まで出す。** 何が足りないかだけでは、何をすればよいか分からない。
 */
export function describe(gaps) {
  if (gaps.length === 0) return [];
  return [
    "",
    `隔離の設定が欠けている（${gaps.length}件）。**このままでは、外向き通信が絞られない。**`,
    "",
    ...gaps.flatMap((g) => [`  ${g.path}`, `      ${g.gap}`, `      ${g.why}`, ""]),
    "このファイルはプロジェクトのものであり、kit は書き換えない。**直すのはこちらである。**",
    "元の形は kit の templates/devcontainer/devcontainer.json にある。",
  ];
}
