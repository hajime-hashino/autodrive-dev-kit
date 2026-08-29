/**
 * 提出を経ずに既定ブランチへ入った変更の検出。
 *
 * 段階0で、不変条件「AIがこれらを無効化できないこと」は**強制ではなく検出で代替
 * する**と決めた。しかし検出そのものが無く、規約だけで担保している状態が続いて
 * いた。実際に直接コミットが起き（AUT-42）、機械は何も言わなかった。
 *
 * **提出を経た変更は、既定ブランチへマージコミットとして入る。** したがって
 * first-parent を辿り、マージでないコミットを候補とする。
 *
 * 除外するのは**親を持たないコミット**だけとする。リポジトリの作成時点であり、
 * 提出の仕組みがまだ存在しない。境界表の初期設置を動きとして数えないのと同じ。
 *
 * squash マージを使う実装では全コミットが非マージになる。その場合に誤検出しない
 * よう、候補が出たときだけ Repo API で統合済みの提出に含まれるかを確かめる。
 * **通常は API 呼び出しが発生しない。**
 */

/** @typedef {{ sha: string, subject: string }} DirectCommit */
/**
 * 手元の設定から既定ブランチを読む。設定されていなければ null。
 *
 * **無いことを異常としない。** `git clone` は `origin/HEAD` を置くが、`git init`
 * から作った作業ツリーには無い。実際に1リポジトリで無かった。ここで止めると、
 * 問題の無いリポジトリに対して誤警報を出すことになる。呼び出し側が別の手段で
 * 補う。
 */
export function localDefaultBranch(repo) {
  const head = repo.git("symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  if (head === null) return null;
  const branch = head.trim().replace(/^origin\//, "");
  return branch === "" ? null : branch;
}

/**
 * 既定ブランチの first-parent のうち、マージでないコミット。
 *
 * 履歴を読めない場合は null を返す。**空配列と区別する。**
 * 「調べたが無かった」と「調べられなかった」を同じ値で表すと、判定できない状態が
 * 通過に紛れる。
 */
export function directCommitCandidates(repo , branch) {
  // %P は親の一覧。空なら根、1つならマージでない、2つ以上ならマージ。
  const log = repo.git("log", "--first-parent", "--format=%H%x09%P%x09%s", `origin/${branch}`);
  if (log === null) return null;

  const candidates = [];
  for (const line of log.split("\n")) {
    if (line.trim() === "") continue;
    const [sha, parents, ...rest] = line.split("\t");
    if (sha === undefined || parents === undefined) continue;
    const count = parents.trim() === "" ? 0 : parents.trim().split(/\s+/).length;
    if (count === 0) continue; // リポジトリの作成時点
    if (count >= 2) continue; // 提出を経て入った
    candidates.push({ sha, subject: rest.join("\t") });
  }
  return candidates;
}
