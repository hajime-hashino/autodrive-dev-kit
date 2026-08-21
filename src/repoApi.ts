/**
 * Repo ポートの読取。現在の実装は GitHub。
 *
 * 実装名を知るのはこの層だけとする（定義§16）。判定側は「保護設定が読めたか」
 * だけを見る。
 */

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface RepoApi {
  readonly available: boolean;
  rulesets(slug: string): Promise<ApiResponse>;
}

export function createRepoApi(token: string | undefined): RepoApi {
  return {
    available: Boolean(token),
    async rulesets(slug: string): Promise<ApiResponse> {
      if (!token) return { status: 0, body: { message: "トークンが無い" } };
      try {
        const res = await fetch(`https://api.github.com/repos/${slug}/rulesets`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "autodrive-verify",
          },
          signal: AbortSignal.timeout(20_000),
        });
        let body: unknown = {};
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
    },
  };
}

export function isPlanLimited(res: ApiResponse): boolean {
  if (res.status !== 403) return false;
  const message = (res.body as { message?: unknown })?.message;
  return typeof message === "string" && message.includes("Upgrade");
}
