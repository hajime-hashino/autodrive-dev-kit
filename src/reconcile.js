/**
 * 統合された作業単位を閉じる。
 *
 * **入口はあったが、出口が無かった。** `begin` が着手のときに started へ進めるのに、
 * 統合されたあと done へ戻す手順がどこにも無かった。結果、34件が着手中のまま溜まり、
 * **そのうち30件は提出が統合済みだった**（AUT-114）。
 *
 * 溜まったのは忘れたからではない。作業ルールが言うとおりである。
 *
 * > 規約が存在しても、手順を通らなければ思い出す機会が無い。
 *
 * だから、思い出す必要のある手順を足さない。**次に着手するときに、ついでに閉じる。**
 * `begin` は必ず通る。通れば片付く。
 *
 * ## 何を根拠に閉じるか
 *
 * Repo に統合済みの提出があること。**手元の git を根拠にしない。** まとめて1つに
 * 潰す統合（squash）だと枝の先が既定ブランチの祖先にならず、統合済みでも「まだ」と
 * 判定してしまう。
 */

/**
 * 提出から作業単位のIDを読む。
 *
 * **枝の名前と題の両方を見る。** 枝の名前は `--branch` で変えられるため、それだけを
 * 根拠にすると、名前を変えた作業単位が永遠に閉じない。
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

/**
 * 応答から提出を取り出す。統合されたかどうかも併せて持つ。
 *
 * **統合されたものだけに絞らない。** 提出は、統合されていなくても**どのリポジトリの
 * 作業だったか**を知っている。絞ると、まだ統合されていない作業単位にラベルを補えない。
 *
 * 読めなかった場合は null を返す。**空と区別する。** 空を返すと「統合された作業単位
 * は無かった」と読めてしまい、読めなかったことが消える。
 *
 * @param {{ status: number, body: unknown }} res
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
 * 閉じる対象を決める。
 *
 * **着手中のものだけを見る。** 既に閉じたものを閉じ直しても実装側は受け付けるが、
 * 何件閉じたかの数が意味を失う。
 *
 * `except` は、いま着手したばかりの作業単位。**自分で着手して自分で閉じない。**
 * 前の提出の枝を使い回した場合に起こりうる。
 *
 * @param {import("./ports/tracker.js").WorkItemView[]} items
 * @param {Set<string>} mergedIds
 * @param {string | undefined} except
 */
export function finished(items, mergedIds, except = undefined) {
  return items.filter(
    (i) => i.state === "started" && i.id !== except && mergedIds.has(i.id),
  );
}

/**
 * ラベルの付いていない着手中の作業単位に、対象リポジトリを補う。
 *
 * **統合済みの提出が、どのリポジトリの作業だったかを知っている。** ラベルの仕掛けを
 * 入れる前に着手したものは、そこから引き直せる。
 *
 * @param {import("./ports/tracker.js").WorkItemView[]} items
 * @param {Map<string, string>} repoOf 作業単位ID → リポジトリ名
 */
export function unmarked(items, repoOf) {
  return items
    .filter((i) => i.state === "started" && i.repo === null && repoOf.has(i.id))
    .map((i) => ({ item: i, repo: (repoOf.get(i.id)) }));
}

/**
 * 対象のリポジトリを見て、統合された作業単位を閉じ、ラベルを補う。
 *
 * **失敗しても呼び出し側を止めない。** 片付けは着手のついでに行うものであり、
 * 片付けられないことを理由に着手できなくなるのは本末転倒である。読めなかった場合は
 * その旨を返し、**黙って空を返さない。**
 *
 * @param {{
 *   repos: Array<{ name: string, slug: string | null }>,
 *   tracker: { list: (n?: number) => Promise<import("./ports/tracker.js").WorkItemView[]>,
 *              advance: (id: string, to: string, repo?: string) => Promise<unknown>,
 *              mark?: (id: string, repo: string) => Promise<unknown> },
 *   api: { available: boolean, submissionsIn: (slug: string) => Promise<{ status: number, body: unknown }> },
 *   except?: string,
 * }} deps
 * @returns {Promise<{ closed: string[], marked: string[], unreadable: string[] }>}
 */
export async function reconcile({ repos, tracker, api, except = undefined }) {
  const out = { closed: [], marked: [], unreadable: [] };
  if (!api.available) {
    out.unreadable.push("Repo の資格情報が無い");
    return out;
  }

  /** 作業単位ID → リポジトリ名。統合の有無によらず、提出があれば分かる。 */
  const repoOf = new Map();
  /** 統合済みの作業単位。**閉じてよいのはこちらだけ。** */
  const mergedIds = new Set();

  for (const repo of repos) {
    if (repo.slug === null) {
      out.unreadable.push(`${repo.name}: 置き場所を特定できない`);
      continue;
    }
    const submissions = submissionsFrom(await api.submissionsIn(repo.slug));
    if (submissions === null) {
      out.unreadable.push(`${repo.name}: 提出を読めない`);
      continue;
    }
    for (const s of submissions) {
      const id = workItemOf(s);
      if (id === null) continue;
      // **先に見つけた方を残す。** 同じ作業単位の提出が複数あっても、書き込み先の
      // リポジトリは1つに限られているため、どちらでも同じ値になる。
      if (!repoOf.has(id)) repoOf.set(id, repo.name);
      if (s.merged) mergedIds.add(id);
    }
  }
  if (repoOf.size === 0) return out;

  const items = await tracker.list();
  for (const item of finished(items, mergedIds, except)) {
    // 閉じるときも対象リポジトリを渡す。**ラベルの無いまま閉じると、履歴として引けない。**
    await tracker.advance(item.id, "done", item.repo ?? repoOf.get(item.id));
    out.closed.push(item.id);
  }
  if (tracker.mark !== undefined) {
    for (const { item, repo } of unmarked(items, repoOf)) {
      if (out.closed.includes(item.id)) continue;
      await tracker.mark(item.id, repo);
      out.marked.push(`${item.id} → ${repo}`);
    }
  }
  return out;
}

/** 結果を人が読む形にする。何も起きなかった場合は空を返す。 */
export function describe(result) {
  const lines = [];
  if (result.closed.length > 0) {
    lines.push("", `統合済みだった作業単位を閉じた（${result.closed.length}件）:`);
    lines.push(`  ${result.closed.join(", ")}`);
  }
  if (result.marked.length > 0) {
    lines.push("", `対象リポジトリを補った（${result.marked.length}件）:`);
    for (const m of result.marked) lines.push(`  ${m}`);
  }
  // **読めなかったことは黙らない。** 黙ると「片付いている」と読める。
  if (result.unreadable.length > 0) {
    lines.push("", "統合を確かめられなかった:");
    for (const u of result.unreadable) lines.push(`  ${u}`);
  }
  return lines;
}
