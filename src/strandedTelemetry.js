/**
 * 提出のあとに書かれた記録を、取り残さないこと。
 *
 * ## なぜ毎回起きるか
 *
 * トークンの記録はフック（Stop / SessionEnd）が書く。**順番が決まっている。**
 *
 *   1. コミットする
 *   2. 提出する
 *   3. 人に報告して止まる → ここでフックが走り、追記される
 *   4. 次の作業へ移る。ブランチが変わる
 *
 * **3 は必ず 1 の後に来る。** したがって、最後の1件は構造的にコミットされない。
 * 忘れたからではない（AUT-156）。
 *
 * ## 実際にどうなっていたか
 *
 * 記録は消えてはいなかった。`begin` が既定ブランチを最新にしてからブランチを作るため、
 * 未コミットの追記はそのまま次のブランチへ持ち越され、**次の作業単位のコミットに紛れて
 * 入っていた。** 参照実装で数えると、トークン記録 55 件のうち **51 件が別の作業単位の
 * コミットで入っていた。** 拾えていたのは、たまたま次の作業がそこにあったからである。
 *
 * **たまたまに頼っている以上、次が無ければ残る。** 測った時点で、4つのリポジトリ
 * すべてに取り残しがあった（6行・約4000万トークン）。どれもそのリポジトリで最後に
 * 行われた作業単位の分である。
 *
 * ## なぜ拾う側を `begin` に置くか
 *
 * **フックにコミットさせない。** フックが走る時点で、そのブランチの提出は既に閉じている
 * ことがある。閉じたブランチへ積んでも既定ブランチには届かない（AUT-38 と同じ形）。
 *
 * **記録の置き場を履歴の外へ移さない。** 移せば構造的には解けるが、記録が履歴に
 * 載らなくなる。定義§16は記録の置き場を寿命で決めており、テレメトリは集計対象と
 * して残るものである。**大きな作り替えを、小さな取りこぼしの対処として持ち込まない。**
 *
 * `begin` は必ず通る入口であり、そこには**既定ブランチから作ったばかりのブランチがある。**
 * 拾った記録が確実に提出へ乗る場所は、ここしかない。
 *
 * ## この形が引き換えにするもの
 *
 * **ブランチへ載せる以上、そのブランチが捨てられれば記録も一緒に埋もれる。** 持ち
 * 越すだけなら手元に残り続けたので、ここは後退である。取ったのは、**埋もれたことに
 * は気づけるが、たまたま拾われないことには気づけない**ためである。
 *
 * `begin` は既定ブランチにいないと進まない。捨てたブランチの上から次を始めようとすれば
 * そこで止まり、提出したのかを問われる。**捨てる判断は、必ず人を通る。**
 *
 * ## 拾えないもの
 *
 * **他のリポジトリの取り残しは、ここでは拾わない。** 1つの作業単位が変更を書き込む
 * リポジトリは1つに限るためである（`CLAUDE.md`）。**代わりに、あることを言う。**
 * 黙ると、そのリポジトリで次の作業が起きるまで誰も知らない。
 */

/** 記録ファイルかどうか。**`telemetry/` の直下の `.jsonl` だけを見る。** */
const TELEMETRY = /^telemetry\/[^/]+\.jsonl$/;

/**
 * 未コミットの記録ファイル。
 *
 * `git status --porcelain -uall` の出力を読む。**追跡されていないものも拾う。**
 * 新しい作業単位の1件目は、ファイルごと新しい。
 *
 * **記録以外には触らない。** 手元に残っている他の変更は、拾う対象ではない。
 * まとめてコミットすると、作業中のものを勝手に履歴へ載せることになる。
 */
export function strandedFiles(porcelain) {
  const found = [];
  for (const line of (porcelain ?? "").split("\n")) {
    if (line.length < 4) continue;
    // `XY PATH`。名前が変わったものは `XY ORIG -> PATH` になる。
    let path = line.slice(3).trim();
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4).trim();
    // 引用符付きで出ることがある（空白や非 ASCII を含む場合）。
    if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
    if (!TELEMETRY.test(path)) continue;
    if (!found.includes(path)) found.push(path);
  }
  return found;
}

/**
 * 拾ったことを説明するコミットの本文。
 *
 * **どの作業単位の記録なのかを、件名ではなく本文に書く。** 件名は、このブランチの作業単位
 * のものである。中身は前の作業単位の記録であり、そこを混ぜると履歴が読めなくなる。
 */
export function commitMessage(workItemId, files) {
  return [
    `${workItemId} 取り残された記録を拾う`,
    "",
    "提出のあとに書かれた記録は、その作業単位のコミットには入らない。",
    "報告して止まった時点でフックが走るため、最後の1件は必ず後から来る（AUT-156）。",
    "",
    "拾ったもの:",
    ...files.map((f) => `  ${f}`),
  ].join("\n");
}

/** 他のリポジトリの取り残しを、読める形にする。 */
export function describeOthers(entries) {
  const found = entries.filter((e) => e.files.length > 0);
  if (found.length === 0) return [];
  return [
    "",
    "**他のリポジトリに、取り残された記録がある。** ここでは拾えない（1つの作業単位が",
    "書き込むリポジトリは1つに限るため）。そのリポジトリで次に着手したときに乗る。",
    ...found.flatMap((e) => [`  ${e.name}`, ...e.files.map((f) => `    ${f}`)]),
  ];
}

/**
 * 取り残された記録を、いまのブランチへ載せる。
 *
 * **失敗しても着手は成立させる。** 拾えないことを理由に着手できなくなるのは本末
 * 転倒である。ただし黙らない。
 *
 * @param {string} repoPath 対象リポジトリ
 * @param {string} workItemId いま着手した作業単位
 * @param {(repoPath: string, args: string[]) => string} git
 * @returns {string[]} 報告の行
 */
export function sweep(repoPath, workItemId, git) {
  let status;
  try {
    status = git(repoPath, ["status", "--porcelain", "-uall"]);
  } catch (error) {
    return ["", `取り残された記録を調べられなかった: ${message(error)}`];
  }

  const files = strandedFiles(status);
  if (files.length === 0) return [];

  try {
    git(repoPath, ["add", "--", ...files]);
    // **パスを指してコミットする。** 手元に他の変更があっても巻き込まない。
    git(repoPath, ["commit", "-m", commitMessage(workItemId, files), "--", ...files]);
  } catch (error) {
    return [
      "",
      "**取り残された記録があるが、コミットできなかった。**",
      `  ${message(error)}`,
      "手元に残っているので、この作業単位の変更と一緒に提出すること:",
      ...files.map((f) => `  ${f}`),
    ];
  }

  return ["", "取り残された記録を拾って、このブランチへ載せた:", ...files.map((f) => `  ${f}`)];
}

/** 例外から読める文を取り出す。 */
function message(error) {
  return error instanceof Error ? error.message : String(error);
}
