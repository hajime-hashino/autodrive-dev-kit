/**
 * Tracker ポートの GitHub Issues アダプタ。
 *
 * **実装名を知るのはこの層だけとする（定義§16）。** 呼び出し側は
 * 「作業単位を起票する」としか言わない。
 *
 * ## 実装が足りない分を、この層が埋める
 *
 * Linear は識別子も5つの状態も自分で持っている。**GitHub Issues はどちらも
 * 持っていない。** 埋め方はここに閉じる。呼び出し側へ漏らさない。
 *
 * | ポートが要るもの | GitHub が持っているもの | ここでの埋め方 |
 * |---|---|---|
 * | `AIEP-123` のような識別子 | リポジトリごとの番号 `123` | 構成の接頭辞を付ける |
 * | 5つの状態 | open / closed と閉じた理由 | 開いている側をラベルで分ける |
 * | 対象リポジトリの欄 | 無い | ラベル（Linear と同じ） |
 *
 * ### なぜ接頭辞を付けるか
 *
 * `#123` は**ブランチ名としては通るが、シェルで壊れる。** `git checkout #123` は
 * コメントになり、`cat telemetry/#123.jsonl` も同じである。番号だけにすると
 * リポジトリをまたいで衝突する。ADR 0013。
 *
 * ### なぜラベルで状態を持つか
 *
 * Projects v2 の Status を使う案もあるが、**プロジェクトを先に作って紐づける手順が
 * 要る。** 用意されていない対象で着手が落ちることになり、落ちる先は規約を知らない
 * 人の手元である。**ラベルはその場で作れる**（Linear アダプタも同じ判断をしている）。
 *
 * **backlog にラベルを置かない。** 起票したままの状態が backlog であり、そこに
 * 印を要求すると、人が普通に立てた Issue が状態を持たないものになる。
 */

/** 開いている状態を分けるラベル。**接頭辞を付けるのは、人のラベルと混ざらないため。** */
const STATE_MARK = "state:";

/** 対象リポジトリを持たせるラベル。**Linear アダプタと同じ形にする。** */
const REPO_MARK = "repo:";

/** ラベルの並びから、対象リポジトリを読む。無ければ null。 */
export function repoFrom(names) {
  const found = names.find((n) => n.startsWith(REPO_MARK));
  return found === undefined ? null : found.slice(REPO_MARK.length);
}

/**
 * Issue の状態を、ポートの語彙へ寄せる。
 *
 * **閉じている理由を見る。** `not_planned` で閉じたものを `done` と読むと、
 * やらないと決めたものが完了として数えられる。
 *
 * @returns {import("../ports/tracker.js").WorkItemState}
 */
export function stateOf(raw) {
  if (raw.state === "closed") return raw.state_reason === "not_planned" ? "canceled" : "done";
  const names = (raw.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  const mark = names.find((n) => n.startsWith(STATE_MARK));
  const said = mark === undefined ? "" : mark.slice(STATE_MARK.length);
  return said === "started" || said === "todo" ? said : "backlog";
}

/** 番号から識別子を作る。 */
export const idOf = (prefix, number) => `${prefix}-${number}`;

/**
 * 識別子から番号を取り出す。**形が違えば投げる。**
 *
 * **黙って数字だけを拾わない。** 別のリポジトリの識別子を渡されたとき、番号が
 * 合っていれば通ってしまう。**通ると、関係の無い Issue を進めることになる。**
 */
export function numberOf(prefix, id) {
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(id ?? "").trim());
  if (m === null) {
    throw new Error(`作業単位IDの形が違う: ${id}（この対象は ${prefix}-<番号>）`);
  }
  return Number(m[1]);
}

export class GithubIssuesTracker {
  #token;
  #slug;
  #prefix;

  /**
   * @param {string} token
   * @param {string} slug `owner/repo`
   * @param {string} prefix 作業単位IDの接頭辞
   */
  constructor(token, slug, prefix) {
    this.#token = token;
    this.#slug = slug;
    this.#prefix = prefix;
  }

  /**
   * REST を直に呼ぶ。**`gh` CLI に頼らない。**
   *
   * 依存を持たない（ADR 0001）。`repoApi.js` が同じ形で既に動いており、
   * **叩き方を2つ持たない。**
   *
   * **応答に型を置かない。** 実装側の形はこの層の外へ出ないため、`any` のまま
   * 受けて `#toView` で語彙へ寄せる（`trackerLinear.js` と同じ）。
   *
   * @param {string} method
   * @param {string} path
   * @param {Record<string, unknown>} [body]
   * @returns {Promise<any>}
   */
  async #call(method, path, body = undefined) {
    const res = await fetch(`https://api.github.com/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "autodrive-dev-kit",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    /** @type {any} */
    let payload = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok) {
      const said = payload?.message ?? `HTTP ${res.status}`;
      // **権限不足は、そうと分かる形で言う。** 「失敗した」だけでは、
      // 資格情報を取り直せばよいのか、対象が無いのかが読めない。
      const hint =
        res.status === 403 || res.status === 401
          ? "（資格情報の権限を確かめること。issues への書き込みが要る）"
          : res.status === 404
            ? "（対象が無いか、読む権限が無い）"
            : "";
      throw new Error(`Tracker への要求が失敗した: ${said}${hint}`);
    }
    return payload;
  }

  /** @returns {import("../ports/tracker.js").WorkItemView} */
  #toView(raw) {
    return {
      id: idOf(this.#prefix, raw.number),
      title: raw.title ?? "",
      url: raw.html_url ?? "",
      body: raw.body ?? "",
      state: stateOf(raw),
      repo: repoFrom((raw.labels ?? []).map((l) => (typeof l === "string" ? l : l.name))),
    };
  }

  async get(id) {
    if (id !== undefined) {
      const raw = await this.#call("GET", `repos/${this.#slug}/issues/${numberOf(this.#prefix, id)}`);
      return this.#toView(raw);
    }
    // 次に着手する対象。未着手のうち最も古いものとする（Linear と同じ）。
    const open = await this.#openIssues(50, "asc");
    return open.find((n) => n.state === "todo" || n.state === "backlog") ?? null;
  }

  /**
   * 開いている Issue を読む。
   *
   * **提出（PR）を落とす。** GitHub の Issues API は PR も返す。落とさないと、
   * 提出が作業単位として数えられる。
   */
  async #openIssues(limit, direction = "desc") {
    const raw = await this.#call(
      "GET",
      `repos/${this.#slug}/issues?state=all&per_page=${limit}&sort=created&direction=${direction}`,
    );
    return raw.filter((r) => r.pull_request === undefined).map((r) => this.#toView(r));
  }

  async list(limit = 100) {
    // **100件を超えては読まない。** 1ページに収まる上限であり、超える分は
    // 追わない。追うなら件数が読める形にする必要がある。
    return this.#openIssues(Math.min(limit, 100));
  }

  async create(input) {
    const raw = await this.#call("POST", `repos/${this.#slug}/issues`, {
      title: input.title,
      body: input.body,
    });
    return this.#toView(raw);
  }

  /** いま付いているラベルの名前。 */
  async #labelsOf(number) {
    const raw = await this.#call("GET", `repos/${this.#slug}/issues/${number}`);
    return { raw, names: (raw.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)) };
  }

  /**
   * 接頭辞の付いたラベルを、1つだけにする。
   *
   * **古いものを消してから付ける。** 残したまま足すと、どちらが本当か読む側から
   * 分からない。**間違ったラベルは、ラベルが無いより悪い**（Linear アダプタと同じ判断）。
   */
  async #setMark(number, mark, value) {
    const { names } = await this.#labelsOf(number);
    const want = value === null ? null : `${mark}${value}`;
    for (const name of names.filter((n) => n.startsWith(mark) && n !== want)) {
      await this.#call("DELETE", `repos/${this.#slug}/issues/${number}/labels/${encodeURIComponent(name)}`);
    }
    if (want === null || names.includes(want)) return;
    // **ラベルは、無ければ作られる。** 事前に用意しておくことを使う側に課さない。
    await this.#call("POST", `repos/${this.#slug}/issues/${number}/labels`, { labels: [want] });
  }

  async mark(id, repo) {
    const number = numberOf(this.#prefix, id);
    await this.#setMark(number, REPO_MARK, repo);
    return this.get(id);
  }

  /**
   * 状態を進める。着手のときは、対象リポジトリも記す。
   *
   * **ラベルを先に付ける。** 後にすると、状態だけ進んでラベルの無い作業単位が残る。
   *
   * @param {string} id
   * @param {import("../ports/tracker.js").WorkItemState} to
   * @param {string} [repo]
   */
  async advance(id, to, repo = undefined) {
    const number = numberOf(this.#prefix, id);
    if (repo !== undefined && repo !== "") await this.#setMark(number, REPO_MARK, repo);

    if (to === "done" || to === "canceled") {
      // **閉じるときは、開いている側のラベルを落とす。** 残すと、閉じた Issue に
      // 「着手中」の印が付いたままになる。
      await this.#setMark(number, STATE_MARK, null);
      await this.#call("PATCH", `repos/${this.#slug}/issues/${number}`, {
        state: "closed",
        state_reason: to === "done" ? "completed" : "not_planned",
      });
      return this.get(id);
    }

    // **開け直しも行う。** 閉じたものへ着手できないと、締め直しの経路が無くなる。
    await this.#call("PATCH", `repos/${this.#slug}/issues/${number}`, { state: "open" });
    await this.#setMark(number, STATE_MARK, to === "backlog" ? null : to);
    return this.get(id);
  }

  async note(id, text) {
    await this.#call("POST", `repos/${this.#slug}/issues/${numberOf(this.#prefix, id)}/comments`, {
      body: text,
    });
  }
}
