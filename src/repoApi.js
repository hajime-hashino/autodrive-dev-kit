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
