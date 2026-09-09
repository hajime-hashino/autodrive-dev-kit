/**
 * Repo ポートの読取。現在の実装は GitHub。
 *
 * 実装名を知るのはこの層だけとする（定義§16）。判定側は「保護設定が読めたか」
 * だけを見る。
 */

/** @typedef {{ status: number, body: unknown }} ApiResponse */
export function createRepoApi(token) {
  const get = async (path) => {
    if (!token) return { status: 0, body: { message: "トークンが無い" } };
    try {
      const res = await fetch(`https://api.github.com/${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "autodrive-dev-kit",
        },
        signal: AbortSignal.timeout(20_000),
      });
      let body = {};
      try {
        body = await res.json();
      } catch {
        body = {};
      }
      return { status: res.status, body };
    } catch (error) {
      // 通信できない場合も判定不能として扱う。status 0 が「読めなかった」を表す。
      const message = error instanceof Error ? error.message : String(error);
      return { status: 0, body: { message } };
    }
  };

  return {
    available: Boolean(token),
    rulesets: (slug) => get(`repos/${slug}/rulesets`),
    submissionsFor: (slug, sha) => get(`repos/${slug}/commits/${sha}/pulls`),
    // 閉じた提出を新しい順に見る。**統合されたかを、手元の git ではなくここで確かめる。**
    // まとめて1つに潰す統合だと、ブランチの先頭コミットが既定ブランチの祖先にならない。
    submissionsIn: (slug) => get(`repos/${slug}/pulls?state=closed&per_page=100&sort=updated&direction=desc`),
    repository: (slug) => get(`repos/${slug}`),
  };
}

/** 応答から既定ブランチを読む。読めなければ null。 */
export function defaultBranchOf(res) {
  if (res.status !== 200) return null;
  const value = (res.body)?.default_branch;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** 応答の中に、統合済みの提出が1件以上あるか。 */
export function hasMergedSubmission(res) {
  if (res.status !== 200 || !Array.isArray(res.body)) return false;
  return res.body.some((p) => Boolean((p)?.merged_at));
}

export function isPlanLimited(res) {
  if (res.status !== 403) return false;
  const message = (res.body)?.message;
  return typeof message === "string" && message.includes("Upgrade");
}

/**
 * 応答から提出を取り出す。統合されたかどうかも併せて持つ。
 *
 * 読めなかった場合は null を返す。**空と区別する。** 空を返すと「統合された提出は
 * 無かった」と読めてしまい、読めなかったことが消える。
 *
 * @param {ApiResponse} res
 * @returns {Array<{ branch: string, title: string, merged: boolean }> | null}
 */
export function submissionsFrom(res) {
  if (res.status !== 200 || !Array.isArray(res.body)) return null;
  return res.body.map((p) => ({
    branch: p?.head?.ref ?? "",
    title: p?.title ?? "",
    merged: Boolean(p?.merged_at),
  }));
}

/**
 * 提出から作業単位のIDを読む。
 *
 * **ブランチ名と題の両方を見る。** ブランチ名は着手のときに変えられるため、それだけを
 * 根拠にすると、名前を変えた作業単位を取り逃がす。
 *
 * @param {{ branch: string, title: string }} submission
 * @returns {string | null}
 */
export function workItemOf(submission) {
  for (const text of [submission.branch, submission.title]) {
    const found = /\b([A-Za-z]{2,10}-\d+)\b/.exec(text ?? "");
    if (found !== null) return found[1].toUpperCase();
  }
  return null;
}
