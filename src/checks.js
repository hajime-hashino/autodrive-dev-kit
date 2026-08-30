/**
 * 4つの不変条件（定義§9）の判定。
 *
 * 判定材料は、リポジトリの内容・git 履歴・Repo API の応答に限る。
 * 「やっています」と書かれたファイルの存在は根拠にしない。宣言で有効を
 * 名乗れる構造では、接続されないまま運用が続く事故を防げないため。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ACTIVE, INVARIANTS, NOT_IN_SCOPE, Result, SUBSTITUTED, UNSUBSTITUTED } from "./state.js";

import { EMITTERS, REQUIRED_EVENT_ATTRS, firstSubstitutionDetail, isUnattributed } from "./telemetry.js";

import { boundaryFor, eventsAfter } from "./enactment.js";
import { movedAreas, parseAreas } from "./boundaries.js";
import { directCommitCandidates, localDefaultBranch } from "./directCommits.js";
import { defaultBranchOf, hasMergedSubmission, isPlanLimited } from "./repoApi.js";

/** @typedef {import("./repos.js").Repo} Repo */
/** @typedef {import("./repoApi.js").RepoApi} RepoApi */
/** @typedef {import("./ports/tracker.js").TrackerPort} TrackerPort */
/** @typedef {{ repos: Repo[], events: TelemetryEvent[], broken: string[], api: RepoApi, tracker: TrackerPort | null, scope: Scope }} CheckInput */
function resultFor(key) {
  const invariant = INVARIANTS.find((i) => i.key === key);
  if (invariant === undefined) throw new Error(`未知の不変条件: ${key}`);
  return new Result(invariant.key, invariant.label);
}

/**
 * 記録を自動で残す仕掛けが、実行基盤に登録されているか。
 *
 * 登録はリポジトリの中（`.claude/settings.json`）にある。リポジトリの外に置くと
 * ここから読めず、外されても気づけない。読める場所にあることが、検出で代替する
 * という方針（BOOTSTRAP）の前提になっている。
 */
export function hookRegistered(repos) {
  for (const repo of repos) {
    const path = join(repo.path, ".claude", "settings.json");
    if (!existsSync(path)) continue;
    let settings;
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (JSON.stringify(settings.hooks ?? {}).includes("record-tokens")) return repo.name;
  }
  return null;
}

/**
 * 記録と作業単位の対応を突き合わせる。
 *
 * 当初は「完了済みの作業単位すべてに記録があること」を条件に置いていたが、
 * そのままでは誤検出になる。作業が発生せずに閉じた作業単位（定義への差し戻しの
 * 起票など）にも記録を要求してしまうためである。
 *
 * 確実に判定できるのは逆向きで、**記録が指す作業単位が実在するか**は誤検出なく
 * 見られる。存在しないIDの記録は、綴り誤りか、作られていない作業単位への記録で
 * あり、どちらも失敗である。
 *
 * 記録の無い完了済み作業単位は観測として出す。作業が無かったのか、記録が別の
 * 作業単位へ流れたのかを、この情報だけでは区別できない。区別できないものを
 * 失敗として扱うと、失敗の意味が薄まる。
 */
async function crossCheckTracker(
  r ,
  events ,
  tracker ,
) {
  const items = await tracker.list();
  const known = new Set(items.map((i) => i.id));
  const recorded = new Set(
    events
      .map((e) => e.work_item_id)
      .filter((id) => typeof id === "string" && id.trim() !== ""),
  );

  const orphans = [...recorded].filter((id) => !known.has(id)).sort();
  if (orphans.length > 0) {
    for (const id of orphans.slice(0, 10)) {
      r.observe(`記録が存在しない作業単位を指している: ${id}`);
    }
    return false;
  }
  r.observe(`記録が指す作業単位 ${recorded.size} 件は、すべて Tracker に実在する`);

  const closedWithout = items
    .filter((i) => i.state === "done" && !recorded.has(i.id))
    .map((i) => i.id)
    .sort();
  if (closedWithout.length > 0) {
    r.observe(
      `記録の無い完了済み作業単位: ${closedWithout.join(", ")}` +
        "（作業が無かったか、記録が別の作業単位へ流れた可能性。区別はできない）",
    );
  }
  return true;
}

/**
 * 有効でないと結論づける。
 *
 * **代替の添付と結論を1つにまとめている。** 別々にしていたとき、添付を忘れた
 * 経路が2度できた（AUT-15 / AUT-33）。忘れられる形にしておくと、同じ型が
 * 別の判定に現れ続ける。
 *
 * 代替の記録が無ければ conclude が UNSUBSTITUTED へ落とす。それは正しい挙動で
 * あり、ここで握りつぶさない。**肩代わりの記録が無ければ、立ち上げ期の例外の条件を
 * 満たしていない**（定義§9）。
 */
function substituted(r , events) {
  const detail = firstSubstitutionDetail(events, r.key);
  if (detail !== null) r.substitutedBy(detail);
  return r.conclude(SUBSTITUTED);
}

// ---------------------------------------------------------------------------

/**
 * テレメトリが記録されること。
 *
 * 「記録がある」では足りない。人や AI が覚えていないと残らない状態は、定義§9の
 * 「ハーネスの既定動作として組み込む」を満たさない。したがって有効の条件は、
 * 記録がアダプタ（ポート語彙）経由で書かれていることとする。
 */
/**
 * 停止の内訳を出す。**判定はしない。**
 *
 * 定義§6（v0.11）は停止を2種類に分ける。**入力を得る停止は減らす対象ではない。**
 * 一括りに数えて減らしにかかると、必要な対話まで削られる。実際にその誤読が起きた
 * （AUT-77）。
 *
 * ここで閾値を置かないのは、**何回なら多いかを決める材料がまだ無い**ため。
 * 数を見せれば、同じ種別が繰り返し出ていること自体が信号になる。定義§6の
 * 「繰り返し出る種別はスキル化・自動化の候補」はそこから読む。
 *
 * **区別の無い記録を欠陥として扱わない。** 種類は AUT-79 で足したものであり、
 * それ以前の記録には無い。遡って分類すると解釈が入る（定義§6は遡及付与を禁じる）。
 */
export function observeStops(r , events) {
  const stops = events.filter((e) => e.type === "stop");
  if (stops.length === 0) return;

  const counts = new Map ();
  for (const stop of stops) {
    const type = typeof stop.stop_type === "string" ? stop.stop_type : "区別なし";
    const key = `${type} / ${typeof stop.stop_kind === "string" ? stop.stop_kind : "不明"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const byType = (t) => stops.filter((e) => (e.stop_type ?? "区別なし") === t).length;
  r.observe(
    `停止 ${stops.length} 件（入力 ${byType("入力")} / 手戻り ${byType("手戻り")}` +
      `${byType("区別なし") > 0 ? ` / 区別なし ${byType("区別なし")}` : ""}）`,
  );
  // 多い順に出す。**繰り返し出ている種別が上に来る。**
  for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    r.observe(`  ${key}: ${n} 件`);
  }
}

/** 値が入っているか。**空文字は「無い」とみなす。** */
function hasValue(event, attr) {
  const value = event[attr];
  return typeof value === "string" && value.trim() !== "";
}

const checkTelemetryRecorded = async ({ repos, events: allEvents, broken, scope, tracker }) => {
  const r = resultFor("telemetry_recorded");

  if (allEvents.length === 0) {
    r.observe("テレメトリのイベントが1件も無い");
    return r.conclude(UNSUBSTITUTED);
  }

  if (broken.length > 0) {
    for (const b of broken) r.observe(`読めない行: ${b}`);
    return r.conclude(UNSUBSTITUTED);
  }

  // 必須属性の妥当性は全期間を対象にする。遡って付与できない属性であり、
  // 境界より前だからといって欠けていてよい理由にはならない。
  // 一方、書き込み経路が自動かどうかは「いまどうなっているか」の問いなので、
  // 境界以降だけを見る。
  const boundary = boundaryFor(allEvents, "telemetry_recorded");
  const events = eventsAfter(allEvents, boundary);

  r.observe(`${allEvents.length} 件のイベントを ${repos.length} リポジトリから読んだ`);
  if (boundary.since === null) {
    r.observe("有効境界が置かれていない。全期間の記録を判定の対象にする");
  } else {
    r.observe(`有効境界: ${boundary.since} 以降の ${events.length} 件を判定の対象にする`);
    if (boundary.moves > 1) {
      // 何回で異常とみなすかは定めない。回数を出し、判断は人に残す。
      r.observe(`有効境界はこれまでに ${boundary.moves} 回動いている（直書きへ戻った回数）`);
    }
  }

  // 属性の存在だけでなく値も見る。アダプタは作業単位を解決できなかった場合に
  // work_item_id へ null を書く。存在確認だけでは、その記録を通してしまう。
  //
  // **帰属できなかった記録だけは、work_item_id を求めない。** 定義§6（v0.10）は、
  // どの作業単位にも属さないやり取り（起票するかの検討、未起票の依頼）を§6の
  // イベントではないと整理している。例外ではなく対象外である。壊れた記録として
  // 扱うと、正しく動いた記録が失敗として現れ続け、遡って付与できないため二度と
  // 消せない。
  //
  // **model は、いつでも付くわけではない。** 値の出どころはセッションの記録であり、
  // それを書くのはターンの終わりに走る仕掛けである。**セッション最初のターンには
  // まだ無い**（AUT-107）。
  //
  // 記録する側が守れない条件を、判定する側が要求してはいけない。**遡って付与
  // できない以上、失敗にすると二度と消せない。** work_item_id と同じ型である。
  //
  // したがって、**アダプタが書いた記録で model が欠けている場合は失敗にしない。**
  // 手で書いた記録は対象外である（emitter が adapter でないものは、そもそも
  // 直書きとして別に扱われる）。
  //
  // **見えなくはしない。** 件数を観測として出す。増えたなら、仕掛けが壊れている。
  const unattributed = allEvents.filter(isUnattributed);
  const missing = [];
  for (const event of allEvents) {
    const exempt = isUnattributed(event) ? new Set(["work_item_id"]) : new Set();
    // アダプタが書いたのに model が無い記録は、壊れているのではなく
    // 「分からなかった」である。
    if (event.emitter === "adapter" && !hasValue(event, "model")) exempt.add("model");
    for (const attr of REQUIRED_EVENT_ATTRS) {
      if (exempt.has(attr)) continue;
      const value = event[attr];
      if (typeof value !== "string" || value.trim() === "") {
        missing.push(`${event.source}: ${attr}${attr in event ? "（値が空）" : "（属性が無い）"}`);
      }
    }
  }
  if (missing.length > 0) {
    for (const m of missing.slice(0, 10)) r.observe(`必須属性が欠けている: ${m}`);
    if (missing.length > 10) r.observe(`...ほか ${missing.length - 10} 件`);
    // 遡って付与できない属性が欠けている。代替では埋められない。
    return r.conclude(UNSUBSTITUTED);
  }
  r.observe(`必須属性 ${REQUIRED_EVENT_ATTRS.join("/")} に、壊れているものは無い`);

  // **見えなくはしない。** model が付かないのはセッション最初のターンだけのはずで
  // あり、増えたなら仕掛けが壊れている。**失敗にはしないが、数は出す。**
  const noModel = allEvents.filter((e) => e.emitter === "adapter" && !hasValue(e, "model"));
  if (noModel.length > 0) {
    r.observe(`model を特定できなかった記録が ${noModel.length} 件ある（いずれもアダプタが書いたもの）`);
    const reasons = [...new Set(noModel.map((e) => String(e.model_unavailable_reason ?? "理由が残っていない")))];
    for (const reason of reasons.slice(0, 3)) r.observe(`  特定できなかった理由: ${reason}`);
  }

  // **見えなくしない。** 件数は、帰属しないやり取りがどれだけあるかの信号であり、
  // 量が無視できなくなったときに§6の判断をやり直す材料になる。
  if (unattributed.length > 0) {
    const reasons = [...new Set(unattributed.map((e) => String(e.unattributed_reason)))];
    r.observe(`作業単位に帰属できなかった記録が ${unattributed.length} 件ある`);
    for (const reason of reasons.slice(0, 3)) r.observe(`帰属できなかった理由: ${reason}`);
  }

  observeStops(r, allEvents);

  const known = new Set (EMITTERS);
  const unknownEmitters = [...new Set(allEvents.map((e) => e.emitter))].filter((v) => !known.has(v));
  if (unknownEmitters.length > 0) {
    r.observe(`emitter に未定義の値がある: ${JSON.stringify(unknownEmitters)}`);
    return r.conclude(UNSUBSTITUTED);
  }

  if (scope === "cross") {
    if (tracker === null) {
      r.observe("Tracker の資格情報が無く、記録と作業単位の対応を確かめられない（LINEAR_API_KEY 未設定）");
      r.observe("判定できない状態は、それ自体を失敗として扱う（定義§9）");
      return r.conclude(UNSUBSTITUTED);
    }
    try {
      if (!(await crossCheckTracker(r, allEvents, tracker))) return r.conclude(UNSUBSTITUTED);
    } catch (error) {
      r.observe(`Tracker を読めない: ${error instanceof Error ? error.message : String(error)}`);
      return r.conclude(UNSUBSTITUTED);
    }
  }
  if (scope === "self") {
    // 1リポジトリの記録だけでは、ハーネスが記録を受け持っているかは決まらない。
    // ここで判定できるのは構造の妥当性（読めること、必須属性が妥当なこと）までで、
    // 有効かどうかを論じること自体が誤りである。
    //
    // 代替の記録を無理に添えて代替を名乗らせるより、判定しないと明示するほうが
    // 正しい。壊れた記録はすでに上で失敗にしているため、見落としは生じない。
    r.observe("記録の構造に問題は無い。有効かどうかは cross でのみ判定する");
    return r.conclude(NOT_IN_SCOPE);
  }

  if (scope === "cross") {
    // 登録は起点のリポジトリに1つ置かれる。self では見えないので判定しない。
    const registeredIn = hookRegistered(repos);
    if (registeredIn === null) {
      r.observe("記録を自動で残す仕掛けが .claude/settings.json に登録されていない");
      // 登録が無ければ、いま自動で書けていても続く保証が無い。有効とは呼べない。
      r.notImplemented("記録の自動化が登録されていないため、有効の条件を満たさない");
    } else {
      r.observe(`記録を自動で残す仕掛けは ${registeredIn} に登録されている`);
    }
  }

  const manual = events.filter((e) => e.emitter === "manual");
  if (manual.length > 0) {
    const sources = [...new Set(manual.map((e) => e.source))].sort();
    r.observe(`${manual.length} 件が emitter=manual（アダプタを経由せずファイルへ直書き）`);
    r.observe(`直書きのあるファイル: ${sources.join(", ")}`);
    return substituted(r, allEvents);
  }

  r.observe("全イベントが emitter=adapter");
  return r.conclude(ACTIVE);
};

// ---------------------------------------------------------------------------

/**
 * 境界変更が履歴に残ること。
 *
 * boundaries.yaml を動かした全コミットが、境界変更履歴から参照されているか。
 * 未参照のコミットが1件でもあれば、残っていない変更があるということ。
 */
const checkBoundaryChangeLogged = async ({ repos, events }) => {
  const r = resultFor("boundary_change_logged");
  const targets = repos.filter((repo) => repo.boundariesFile() !== null);

  if (targets.length === 0) {
    r.observe("boundaries.yaml がどのリポジトリにも無い（動かす対象が存在しない）");
    // 対象が無いことを有効と報告してはいけない。仕組みが無いだけである。
    return substituted(r, events);
  }

  const unreferenced = [];
  for (const repo of targets) {
    const log = repo.git("log", "--format=%H", "--", "boundaries.yaml") ?? "";
    const commits = log.split("\n").map((c) => c.trim()).filter(Boolean);
    const historyPath = repo.boundaryHistoryFile();
    if (historyPath === null) {
      r.observe(`${repo.name}: boundaries.yaml はあるが境界変更履歴が無い`);
      unreferenced.push(...commits);
      continue;
    }
    const text = repo.read(historyPath);
    r.observe(`${repo.name}: boundaries.yaml を変更したコミット ${commits.length} 件を照合`);
    unreferenced.push(...commits.filter((c) => !text.includes(c.slice(0, 7)) && !text.includes(c)));
  }

  if (unreferenced.length > 0) {
    for (const c of unreferenced.slice(0, 10)) {
      r.observe(`履歴から参照されていないコミット: ${c.slice(0, 7)}`);
    }
    return substituted(r, events);
  }

  r.observe("boundaries.yaml の全変更コミットが履歴から参照されている");
  return r.conclude(ACTIVE);
};

// ---------------------------------------------------------------------------

/**
 * 外側ループが起動し、継続すること。
 *
 * 起動は、境界表のセルが動き、その根拠が履歴に残っていることで判定する（定義§8）。
 * 継続の閾値は定めない。定義§17が緩和しきい値を未確定としており、実データなしに
 * 決め打ちすると根拠の無い数字が残るため。
 */
const checkOuterLoopRunning = async ({ repos, events, api }) => {
  const r = resultFor("outer_loop_running");

  // 承認は「変更を統合する」が実行された事実から導出する。宣言に依らないことが
  // 条件である（定義§8）。
  //
  // **読めない場合は代替ではなく失敗にする。** セルが動いているのに承認を
  // 確かめられない状態は、代替なのではなく判定できていない状態であり、
  // 定義§9はそれ自体を失敗として扱うとしている。代替を添えて通すと、判定できて
  // いないことが代替の中に紛れる。
  let approvalUnreadable = null;
  let qualified = 0;

  for (const repo of repos) {
    if (repo.boundariesFile() === null) continue;
    const historyPath = repo.boundaryHistoryFile();
    const history = historyPath === null ? "" : repo.read(historyPath);
    const slug = repo.remoteSlug();

    const log = repo.git("log", "--format=%H", "--", "boundaries.yaml") ?? "";
    const commits = log.split("\n").map((c) => c.trim()).filter(Boolean);
    r.observe(`${repo.name}: boundaries.yaml を変更したコミット ${commits.length} 件`);

    for (const sha of commits) {
      // 初期設置は動きではない。親に版が無いコミットがそれにあたる。
      const after = repo.git("show", `${sha}:boundaries.yaml`);
      const before = repo.git("show", `${sha}^:boundaries.yaml`);
      if (after === null) continue;
      if (before === null) {
        r.observe(`${sha.slice(0, 7)}: 境界表の初期設置（動きとして数えない）`);
        continue;
      }

      const moved = movedAreas(parseAreas(before), parseAreas(after));
      if (moved.length === 0) continue;

      const section = historySectionFor(history, sha);
      if (section === null) {
        r.observe(`${sha.slice(0, 7)}: ${moved.join(", ")} が動いたが、履歴から参照されていない`);
        continue;
      }
      if (!section.includes("根拠")) {
        r.observe(`${sha.slice(0, 7)}: 履歴の記載に根拠が無い`);
        continue;
      }

      if (slug === null) {
        approvalUnreadable ??= `${repo.name}: origin が無く、統合の事実を確かめられない`;
        continue;
      }
      const res = await api.submissionsFor(slug, sha);
      if (!hasMergedSubmission(res)) {
        if (res.status === 200) {
          r.observe(`${sha.slice(0, 7)}: ${moved.join(", ")} が動いたが、まだ統合されていない`);
        } else {
          approvalUnreadable ??=
            `${slug}: 応答 ${res.status} — 提出を読めないため、承認を確かめられない`;
        }
        continue;
      }

      qualified += 1;
      r.observe(`${sha.slice(0, 7)}: ${moved.join(", ")} が動き、根拠と統合済みの提出が揃っている`);
    }
  }

  // 継続の閾値は定めない。定義§17が未確定としており、実データなしに決め打ちすると
  // 根拠の無い数字が残る。
  r.observe("継続の判定は N/A（起動が満たされてから、実データを見て閾値を決める）");

  if (qualified === 0) {
    if (approvalUnreadable !== null) {
      // 代替ではなく、判定できていない。代替を添えて通すと両者が区別できなくなる。
      r.observe(approvalUnreadable);
      r.observe("判定できない状態は、それ自体を失敗として扱う（定義§9）");
      return r.conclude(UNSUBSTITUTED);
    }
    r.observe("セルが動き、根拠と承認の揃ったエントリが無い（外側ループが一周していない）");
    return substituted(r, events);
  }

  // 承認の揃ったエントリが1件でもあれば、起動したかは判定できている。読めなかった
  // 別のエントリは、結論を覆さないが穴なので観測として残す。
  if (approvalUnreadable !== null) r.observe(approvalUnreadable);
  return r.conclude(ACTIVE);
};

/**
 * 提出を経ずに既定ブランチへ入った変更。判定できなければ null を返す。
 *
 * 候補が出たときだけ Repo API に問い合わせる。squash マージを使う実装では
 * 全コミットが非マージになるため、コミットの形だけでは決められない。
 * **通常は候補が出ないので、API 呼び出しは発生しない。**
 */
async function directCommitsAcross(
  r ,
  repos ,
  api ,
) {
  const found = [];
  for (const repo of repos) {
    const slug = repo.remoteSlug();
    if (slug === null) {
      r.observe(`${repo.name}: origin が無く、提出を経たかを確かめられない`);
      return null;
    }

    // 手元の設定を先に見る。無い場合だけ Repo に尋ねる。`git init` から作った
    // 作業ツリーには origin/HEAD が無く、そこで止めると誤警報になる。
    let branch = localDefaultBranch(repo);
    if (branch === null) branch = defaultBranchOf(await api.repository(slug));
    if (branch === null) {
      r.observe(`${repo.name}: 既定ブランチを特定できず、提出を経たかを確かめられない`);
      return null;
    }

    const candidates = directCommitCandidates(repo, branch);
    if (candidates === null) {
      r.observe(`${repo.name}: ${branch} の履歴を読めず、提出を経たかを確かめられない`);
      return null;
    }
    if (candidates.length === 0) continue;

    for (const c of candidates) {
      const res = await api.submissionsFor(slug, c.sha);
      if (hasMergedSubmission(res)) continue; // squash マージ等。提出を経ている
      if (res.status !== 200) {
        r.observe(`${slug}: 応答 ${res.status} — 提出を読めず、${c.sha.slice(0, 7)} を確かめられない`);
        return null;
      }
      found.push(`${repo.name} ${c.sha.slice(0, 7)} ${c.subject}`);
    }
  }
  return found;
}

/** 当該コミットに触れている境界変更履歴の節。見つからなければ null。 */
function historySectionFor(history , sha) {
  const short = sha.slice(0, 7);
  const sections = history.split(/^## /m).slice(1);
  for (const section of sections) {
    if (section.includes(sha) || section.includes(short)) return section;
  }
  return null;
}

// ---------------------------------------------------------------------------

/**
 * AIがこれらを無効化できないこと。
 *
 * 強制ではなく検出で代替する。したがって有効の条件は「AIが実際に無効化できない
 * こと」ではなく、無効化されたら必ず気づけることとする。
 */
const checkAiCannotDisable = async ({ repos, events, api }) => {
  const r = resultFor("ai_cannot_disable");

  if (!api.available) {
    r.observe("Repo API のトークンが無く、保護設定を読めない（AUTODRIVE_CI_TOKEN 未設定）");
    r.observe("判定できない状態は、それ自体を失敗として扱う（定義§9）");
    return r.conclude(UNSUBSTITUTED);
  }

  const unprotected = [];
  const planLimited = [];
  const unreadable = [];

  for (const repo of repos) {
    const slug = repo.remoteSlug();
    if (slug === null) {
      unreadable.push(`${repo.name}: origin が無く、対応する Repo を特定できない`);
      continue;
    }
    const res = await api.rulesets(slug);
    if (res.status === 200) {
      const rules = Array.isArray(res.body) ? res.body : [];
      if (rules.length > 0) r.observe(`${slug}: ruleset ${rules.length} 件`);
      else unprotected.push(slug);
    } else if (isPlanLimited(res)) {
      planLimited.push(slug);
    } else {
      unreadable.push(`${slug}: 応答 ${res.status}`);
    }
  }

  for (const slug of planLimited) {
    r.observe(`${slug}: 403 — 非公開リポジトリに ruleset を設定できないプラン`);
  }
  for (const slug of unprotected) {
    r.observe(`${slug}: ruleset が1件も無い（既定ブランチが保護されていない）`);
  }
  for (const msg of unreadable) r.observe(`読めない: ${msg}`);

  // **保護設定を持てなくても、破られたかどうかは見られる。** 段階0で検出による
  // 代替を選んだ以上、検出が無いまま規約だけで担保する状態を続けない。
  const direct = await directCommitsAcross(r, repos, api);
  if (direct === null) {
    r.observe("判定できない状態は、それ自体を失敗として扱う（定義§9）");
    return r.conclude(UNSUBSTITUTED);
  }
  if (direct.length > 0) {
    for (const line of direct.slice(0, 10)) r.observe(`提出を経ずに既定ブランチへ入っている: ${line}`);
    if (direct.length > 10) r.observe(`...ほか ${direct.length - 10} 件`);
    // 規約が破られている。代替が成立していないため、代替ありでは通さない。
    return r.conclude(UNSUBSTITUTED);
  }
  r.observe("既定ブランチの変更は、すべて提出を経て入っている");

  if (unreadable.length > 0) {
    r.observe("判定できない対象がある。通さない（定義§9）");
    return r.conclude(UNSUBSTITUTED);
  }

  if (planLimited.length > 0 || unprotected.length > 0) {
    // 必須チェックの登録有無も ruleset に依存するため、ここでは判定できない。
    r.notImplemented(
      "invariants を必須チェックとして登録しているかの検証（ruleset が使えないため判定手段が無い）",
    );
    return substituted(r, events);
  }

  r.notImplemented("エージェントに渡っている資格情報が保護設定を変更できないことの検証");
  r.observe("全リポジトリで既定ブランチが保護されている");
  return r.conclude(ACTIVE);
};

// ---------------------------------------------------------------------------

/**
 * どの実行範囲で判定できるか。
 *
 * 不変条件1と4は、リポジトリをまたいで初めて成立するため self では判定しない。
 * 1つのリポジトリだけを見て「外側ループが回っていない」と報告しても、それは
 * 他のリポジトリで回っているかもしれず、判定になっていない。判定できないものを
 * 判定したふりをするほうが、判定しないと明示するより危ない。
 */
export const CHECKS = [
  { key: "outer_loop_running", run: checkOuterLoopRunning, scopes: new Set (["cross"]) },
  {
    key: "telemetry_recorded",
    run: checkTelemetryRecorded,
    scopes: new Set (["cross", "self"]),
  },
  {
    key: "boundary_change_logged",
    run: checkBoundaryChangeLogged,
    scopes: new Set (["cross", "self"]),
  },
  { key: "ai_cannot_disable", run: checkAiCannotDisable, scopes: new Set (["cross"]) },
];
