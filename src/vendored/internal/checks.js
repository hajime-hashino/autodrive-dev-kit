/**
 * 4つの不変条件（定義§9）の判定。
 *
 * 判定材料は、リポジトリの内容・git 履歴・Repo API の応答に限る。
 * 「やっています」と書かれたファイルの存在は根拠にしない。宣言で有効を
 * 名乗れる構造では、接続されないまま運用が続く事故を防げないため。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ACTIVE, INVARIANTS, NOT_IN_SCOPE, Result, SUBSTITUTED, UNSUBSTITUTED } from "./state.js";

import { EMITTERS, REQUIRED_EVENT_ATTRS, firstSubstitutionDetail, isUnattributed } from "./telemetry.js";

import { boundaryFor, eventsAfter } from "./enactment.js";
import { movedAreas, parseAreas } from "./boundaries.js";
import { directCommitCandidates, localDefaultBranch } from "./directCommits.js";
import {
  defaultBranchOf,
  hasMergedSubmission,
  isPlanLimited,
  submissionsFrom,
  workItemOf,
} from "./repoApi.js";

/** @typedef {import("./repos.js").Repo} Repo */
/** @typedef {import("./repoApi.js").RepoApi} RepoApi */
/** @typedef {import("./ports/tracker.js").TrackerPort} TrackerPort */
// **他のファイルにある型は、引いてこないと使えない。** 引かずに名前だけ書いても
// 解決されず、**書いた型が効いていない状態になる**（型検査を入れて判明。AUT-226）。
/** @typedef {import("./telemetry.js").TelemetryEvent} TelemetryEvent */
/** @typedef {import("./state.js").Scope} Scope */
/**
 * 判定へ渡すもの。
 *
 * **`root` は、登録された仕掛けの指す先を解決するために要る**（AUT-207）。
 * 既定値だけを置いて型に書かないと、`null` 型として起き、呼び出し側が落ちる。
 *
 * @typedef {{ repos: Repo[], events: TelemetryEvent[], broken: string[], api: RepoApi, tracker: TrackerPort | null, scope: Scope, root?: string | null }} CheckInput
 */
function resultFor(key) {
  const invariant = INVARIANTS.find((i) => i.key === key);
  if (invariant === undefined) throw new Error(`Unknown invariant: ${key}`);
  return new Result(invariant.key);
}

/**
 * 記録を自動で残す仕掛けが、実行基盤に登録されているか。
 *
 * 登録はリポジトリの中（`.claude/settings.json`）にある。リポジトリの外に置くと
 * ここから読めず、外されても気づけない。読める場所にあることが、検出で代替する
 * という方針（BOOTSTRAP）の前提になっている。
 */
export function hookRegistered(repos) {
  return hookState(repos).registeredIn;
}

/**
 * 登録された仕掛けが、実在するものを指しているか。
 *
 * **登録されていることと、動くことは違う。** 以前は文字列 `record-tokens` が
 * 含まれるかしか見ていなかった。**配布物の置き場所が変わったとき、登録は
 * そのまま残り、指す先だけが消えた**（AUT-202 で `hooks/` が `src/vendored/hooks/`
 * へ移り、3日間トークンが送られていなかった。AUT-207 で判明）。
 *
 * **黙って止まる。** 実行基盤はフックが落ちても作業を止めない（落ちても作業を
 * 止めないのは正しい）。したがって**誰も気づかない。**
 *
 * `${CLAUDE_PROJECT_DIR}` は起点に置き換える。**相対パスは、起点と登録された
 * リポジトリの両方から探す。** どちらの書き方も実在しうる。
 *
 * @returns {{ registeredIn: string | null, command: string | null, missing: string | null }}
 */
/**
 * @param {Repo[]} repos
 * @param {string | null} root
 * @returns {{ registeredIn: string | null, command: string | null, missing: string | null }}
 */
export function hookState(repos, root = null) {
  for (const repo of repos) {
    const path = join(repo.path, ".claude", "settings.json");
    if (!existsSync(path)) continue;
    let settings;
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const found = hookCommands(settings).find((c) => c.includes("record-tokens"));
    if (found === undefined) continue;

    const bases = [root, repo.path].filter((b) => typeof b === "string" && b !== "");
    const resolved = found.replace("${CLAUDE_PROJECT_DIR}/", "").replace("${CLAUDE_PROJECT_DIR}", "");
    const exists = bases.some((b) => existsSync(resolve(b, resolved)));
    return { registeredIn: repo.name, command: found, missing: exists ? null : resolved };
  }
  return { registeredIn: null, command: null, missing: null };
}

/** 登録された命令を並べる。**形が変わっても落ちない。** */
function hookCommands(settings) {
  const out = [];
  const walk = (node) => {
    if (typeof node === "string") return out.push(node);
    if (Array.isArray(node)) return node.forEach(walk);
    if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "command" && typeof value === "string") out.push(value);
        else walk(value);
      }
    }
  };
  walk(settings.hooks ?? {});
  return out;
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
 *
 * **Tracker の状態そのものも、ここで見る。** 完了させる仕組みを連携へ渡した以上
 * （ADR 0007）、それが効いていないことに気づく場所が要る。閉じ忘れも、外れない
 * ままの作業単位マーカーも、記録がどの作業単位に紐づくかを直接左右する。
 */
async function crossCheckTracker(
  r ,
  events ,
  tracker ,
  repos ,
  api ,
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
      r.observe(`A record points at a work item that does not exist: ${id}`);
    }
    return false;
  }
  r.observe(`All ${recorded.size} work items the records point at exist in the Tracker`);

  const closedWithout = items
    .filter((i) => i.state === "done" && !recorded.has(i.id))
    .map((i) => i.id)
    .sort();
  if (closedWithout.length > 0) {
    r.observe(
      `Completed work items with no records: ${closedWithout.join(", ")}` +
        " (either there was no work, or the records went to another work item. These cannot be told apart)",
    );
  }

  await observeUnclosed(r, items, repos, api);
  observeStaleMarker(r, items, repos);
  return true;
}

/**
 * 統合済みの提出があるのに、着手中のまま残っている作業単位。
 *
 * **完了させる仕組みは、もうここには無い。** Tracker と Repo の連携が動かす（ADR 0007）。
 * だから**効いていないことに気づく手段が要る。** 実際に、連携へ移す前に4件が統合済みの
 * まま数日 In Progress で残り、毎朝の横断判定は一度も何も言わなかった（AUT-165）。
 *
 * 連携を設定していない配布先、途中で外れた配布先でも同じ信号が出る。
 *
 * **失敗にはしない。観測に留める。** 不変条件は定義§9のものであり、Tracker 側の設定は
 * その範囲外にある。連携の設定漏れで「テレメトリが記録されること」が落ちるのは、
 * 判定の意味が合わない。**見えれば足りる。**
 *
 * 提出を読めなかったリポジトリは、読めなかったことを言う。**黙ると「取り残しは
 * 無かった」と読める。**
 */
async function observeUnclosed(r , items , repos , api ) {
  if (api === undefined || !api.available) {
    r.observe("No Repo credentials, so it cannot be confirmed whether integrated work items are closed");
    return;
  }
  const started = new Set(items.filter((i) => i.state === "started").map((i) => i.id));
  if (started.size === 0) return;

  const merged = new Set();
  for (const repo of repos) {
    const slug = repo.remoteSlug();
    if (slug === null) {
      r.observe(`${repo.name}: cannot identify where it is hosted, so submissions cannot be confirmed`);
      continue;
    }
    const submissions = submissionsFrom(await api.submissionsIn(slug));
    if (submissions === null) {
      r.observe(`${repo.name}: cannot read submissions, so leftovers cannot be confirmed`);
      continue;
    }
    for (const s of submissions) {
      if (!s.merged) continue;
      const id = workItemOf(s);
      if (id !== null) merged.add(id);
    }
  }

  const unclosed = [...started].filter((id) => merged.has(id)).sort();
  if (unclosed.length > 0) {
    r.observe(`Work items still started though integrated: ${unclosed.join(", ")}`);
    r.observe("The Tracker–Repo integration may not be working (check the setting that moves items to done on integration)");
  }
}

/**
 * 完了した作業単位を指したままの作業単位マーカー。
 *
 * **ここは連携では届かない。** マーカーは手元のファイルであり、Tracker が状態を
 * 動かしても残る。外れないまま記録が続くと、**完了した作業単位に以降の記録が
 * 紐づく。** 実際にこの形が起きている（AUT-163 が統合済みなのにマーカーは
 * AUT-163 を指したままだった）。
 *
 * 着手のたびに上書きされるため、次の着手までの間だけ起こる。**その間に書かれた
 * 記録は、間違った作業単位に入る。**
 */
function observeStaleMarker(r , items , repos ) {
  const closed = new Set(items.filter((i) => i.state === "done" || i.state === "canceled").map((i) => i.id));
  for (const repo of repos) {
    const path = join(repo.path, ".autodrive", "current-work-item.json");
    if (!existsSync(path)) continue;
    let marker;
    try {
      marker = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    const id = marker?.work_item_id;
    if (typeof id !== "string" || !closed.has(id)) continue;
    r.observe(`The work item marker points at a completed work item: ${id} (${repo.name})`);
    r.observe("Records written until the next work item is started will be linked to this work item");
  }
}

/**
 * 有効でないと結論づける。
 *
 * **代替の添付と結論を1つにまとめている。** 別々にしていたとき、添付を忘れた
 * 経路が2度できた（AUT-15 / AUT-33）。忘れられる形にしておくと、同じ型が
 * 別の判定に現れ続ける。
 *
 * 代替の記録が無ければ conclude が UNSUBSTITUTED へ落とす。それは正しい挙動で
 * あり、ここで記録を捨てない。**肩代わりの記録が無ければ、立ち上げ期の例外の条件を
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
    const type = typeof stop.stop_type === "string" ? stop.stop_type : "unclassified";
    const key = `${type} / ${typeof stop.stop_kind === "string" ? stop.stop_kind : "unknown"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const byType = (t) => stops.filter((e) => (e.stop_type ?? "unclassified") === t).length;
  r.observe(
    `Stops: ${stops.length} (input ${byType("input")} / rework ${byType("rework")}` +
      `${byType("unclassified") > 0 ? ` / unclassified ${byType("unclassified")}` : ""})`,
  );
  // 多い順に出す。**繰り返し出ている種別が上に来る。**
  for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    r.observe(`  ${key}: ${n}`);
  }
}

/** 値が入っているか。**空文字は「無い」とみなす。** */
function hasValue(event, attr) {
  const value = event[attr];
  return typeof value === "string" && value.trim() !== "";
}

/** @param {CheckInput} input */
const checkTelemetryRecorded = async ({ repos, events: allEvents, broken, scope, tracker, api, root = null }) => {
  const r = resultFor("telemetry_recorded");

  if (allEvents.length === 0) {
    r.observe("There is not a single telemetry event");
    return r.conclude(UNSUBSTITUTED);
  }

  if (broken.length > 0) {
    for (const b of broken) r.observe(`Unreadable line: ${b}`);
    return r.conclude(UNSUBSTITUTED);
  }

  // 必須属性の妥当性は全期間を対象にする。遡って付与できない属性であり、
  // 有効境界より前だからといって欠けていてよい理由にはならない。
  // 一方、書き込み経路が自動かどうかは「いまどうなっているか」の問いなので、
  // 有効境界以降だけを見る。
  const boundary = boundaryFor(allEvents, "telemetry_recorded");
  const events = eventsAfter(allEvents, boundary);

  r.observe(`Read ${allEvents.length} events from ${repos.length} repositories`);
  if (boundary.since === null) {
    r.observe("No activation boundary is set. Records from the whole period are judged");
  } else {
    r.observe(`Activation boundary: judging the ${events.length} records since ${boundary.since}`);
    if (boundary.moves > 1) {
      // 何回で異常とみなすかは定めない。回数を出し、判断は人に残す。
      r.observe(`The activation boundary has moved ${boundary.moves} times so far (times it fell back to direct writes)`);
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
        missing.push(`${event.source}: ${attr}${attr in event ? " (empty value)" : " (attribute missing)"}`);
      }
    }
  }
  if (missing.length > 0) {
    for (const m of missing.slice(0, 10)) r.observe(`Required attribute missing: ${m}`);
    if (missing.length > 10) r.observe(`...and ${missing.length - 10} more`);
    // 遡って付与できない属性が欠けている。代替では埋められない。
    return r.conclude(UNSUBSTITUTED);
  }
  r.observe(`None of the required attributes ${REQUIRED_EVENT_ATTRS.join("/")} is broken`);

  // **見えなくはしない。** model が付かないのはセッション最初のターンだけのはずで
  // あり、増えたなら仕掛けが壊れている。**失敗にはしないが、数は出す。**
  const noModel = allEvents.filter((e) => e.emitter === "adapter" && !hasValue(e, "model"));
  if (noModel.length > 0) {
    r.observe(`${noModel.length} records could not identify the model (all written by the adapter)`);
    const reasons = [...new Set(noModel.map((e) => String(e.model_unavailable_reason ?? "no reason recorded")))];
    for (const reason of reasons.slice(0, 3)) r.observe(`  Why it could not be identified: ${reason}`);
  }

  // **見えなくしない。** 件数は、帰属しないやり取りがどれだけあるかの信号であり、
  // 量が無視できなくなったときに§6の判断をやり直す材料になる。
  if (unattributed.length > 0) {
    const reasons = [...new Set(unattributed.map((e) => String(e.unattributed_reason)))];
    r.observe(`${unattributed.length} records could not be attributed to a work item`);
    for (const reason of reasons.slice(0, 3)) r.observe(`Why it could not be attributed: ${reason}`);
  }

  observeStops(r, allEvents);

  const known = new Set (EMITTERS);
  // **記録の値は `unknown` である。** 文字列へ寄せてから比べる（AUT-226）。
  const unknownEmitters = [...new Set(allEvents.map((e) => String(e.emitter)))].filter((v) => !known.has(v));
  if (unknownEmitters.length > 0) {
    r.observe(`emitter has undefined values: ${JSON.stringify(unknownEmitters)}`);
    return r.conclude(UNSUBSTITUTED);
  }

  if (scope === "cross") {
    if (tracker === null) {
      r.observe("No Tracker credentials, so records cannot be matched to work items (LINEAR_API_KEY not set)");
      r.observe("A state that cannot be judged is itself treated as a failure (definition §9)");
      return r.conclude(UNSUBSTITUTED);
    }
    try {
      if (!(await crossCheckTracker(r, allEvents, tracker, repos, api))) {
        return r.conclude(UNSUBSTITUTED);
      }
    } catch (error) {
      r.observe(`Cannot read the Tracker: ${error instanceof Error ? error.message : String(error)}`);
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
    r.observe("The structure of the records has no problems. Whether it is active is judged only in cross");
    return r.conclude(NOT_IN_SCOPE);
  }

  if (scope === "cross") {
    // 登録は起点のリポジトリに1つ置かれる。self では見えないので判定しない。
    const hook = hookState(repos, root);
    if (hook.registeredIn === null) {
      r.observe("The mechanism that records automatically is not registered in .claude/settings.json");
      // 登録が無ければ、いま自動で書けていても続く保証が無い。有効とは呼べない。
      r.notImplemented("Recording automation is not registered, so the condition for active is not met");
    } else if (hook.missing !== null) {
      // **登録されているのに、指す先が無い。** 登録だけを見ていると通る。
      r.observe(
        `The mechanism that records automatically points at something that does not exist: ${hook.missing}` +
          ` (${hook.registeredIn}/.claude/settings.json)`,
      );
      r.observe(
        "**The runtime does not stop work when a hook fails.** So recording stops silently. " +
          "This is what happens when the distributed files move and only the registration stays behind",
      );
      // **登録が指す先が無いなら、記録が続く保証は無い。** 有効とは呼べない。
      r.notImplemented("Recording automation points at something that does not exist, so the condition for active is not met");
    } else {
      r.observe(`The mechanism that records automatically is registered in ${hook.registeredIn}`);
    }
  }

  const manual = events.filter((e) => e.emitter === "manual");
  if (manual.length > 0) {
    const sources = [...new Set(manual.map((e) => e.source))].sort();
    r.observe(`${manual.length} are emitter=manual (written directly to the file without the adapter)`);
    r.observe(`Files with direct writes: ${sources.join(", ")}`);
    return substituted(r, allEvents);
  }

  r.observe("All events are emitter=adapter");
  return r.conclude(ACTIVE);
};

// ---------------------------------------------------------------------------

/**
 * 委譲範囲の変更が履歴に残ること。
 *
 * boundaries.yaml を動かした全コミットが、委譲範囲の変更履歴から参照されているか。
 * 未参照のコミットが1件でもあれば、残っていない変更があるということ。
 *
 * ## 初期設置は数えない
 *
 * **表を置くことは、委譲範囲の変更ではない。** 定義§8がそう言っている。
 *
 * > 表を置いた最初の変更は、承認の対象だが起動の証拠にはならない。
 * > **表を用意することと、表を動かすことは別である。**
 *
 * `checkOuterLoopRunning` は最初からこの扱いだったが、**こちらは除外していなかった。**
 * その結果、`init` した全プロジェクトが最初の提出で落ちた（AUT-239、GitHub #102）。
 *
 * **手元では通っていた。** `boundaries.yaml` が未コミットの間は `git log` が空を返す。
 * **コミットした瞬間に落ちる。** 置いた本人には、何が起きたのか分からない。
 */
const checkBoundaryChangeLogged = async ({ repos, events }) => {
  const r = resultFor("boundary_change_logged");
  const targets = repos.filter((repo) => repo.boundariesFile() !== null);

  if (targets.length === 0) {
    r.observe("No repository has boundaries.yaml (there is nothing to move)");
    // 対象が無いことを有効と報告してはいけない。仕組みが無いだけである。
    return substituted(r, events);
  }

  const unreferenced = [];
  for (const repo of targets) {
    const log = repo.git("log", "--format=%H", "--", "boundaries.yaml") ?? "";
    const all = log.split("\n").map((c) => c.trim()).filter(Boolean);

    // **初期設置を落とす。** 親に `boundaries.yaml` が無いコミットがそれにあたる
    // （`checkOuterLoopRunning` と同じ見分け方）。
    const placed = all.filter((sha) => repo.git("show", `${sha}^:boundaries.yaml`) === null);
    const commits = all.filter((sha) => !placed.includes(sha));
    for (const sha of placed) {
      r.observe(`${repo.name}: ${sha.slice(0, 7)} is the initial placement of the delegation table (not counted as a change)`);
    }

    // **動かした変更が無いなら、履歴はまだ要らない。** 置いただけの状態で
    // 「履歴が無い」と言うと、**置いた本人が、何を書けばよいか分からないまま落ちる。**
    if (commits.length === 0) {
      r.observe(`${repo.name}: no change has moved the scope of delegation yet`);
      continue;
    }

    const historyPath = repo.boundaryHistoryFile();
    if (historyPath === null) {
      r.observe(`${repo.name}: boundaries.yaml exists but there is no history of delegation changes`);
      unreferenced.push(...commits);
      continue;
    }
    const text = repo.read(historyPath);
    r.observe(`${repo.name}: checked ${commits.length} commits that changed boundaries.yaml`);
    // **SHA だけで照合しない。** squash / rebase で統合すると SHA が変わり、
    // 履歴が指す先が消える。作業単位のIDでも照合する（AUT-240）。
    unreferenced.push(
      ...commits.filter(
        (c) => historySectionFor(text, c, repo.git("log", "-1", "--format=%s", c)) === null,
      ),
    );

  }

  if (unreferenced.length > 0) {
    for (const c of unreferenced.slice(0, 10)) {
      r.observe(`Commit not referenced from the history: ${c.slice(0, 7)}`);
    }
    return substituted(r, events);
  }

  r.observe("Every commit that changed boundaries.yaml is referenced from the history");
  return r.conclude(ACTIVE);
};

// ---------------------------------------------------------------------------

/**
 * 外側ループが起動し、継続すること。
 *
 * 起動は、委譲範囲の表のセルが動き、その根拠が履歴に残っていることで判定する（定義§8）。
 * 継続の閾値は定めない。定義§18が緩和しきい値を未確定としており、実データなしに
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
  /** @type {string | null} */
  let approvalUnreadable = null;
  let qualified = 0;

  for (const repo of repos) {
    if (repo.boundariesFile() === null) continue;
    const historyPath = repo.boundaryHistoryFile();
    const history = historyPath === null ? "" : repo.read(historyPath);
    const slug = repo.remoteSlug();

    const log = repo.git("log", "--format=%H", "--", "boundaries.yaml") ?? "";
    const commits = log.split("\n").map((c) => c.trim()).filter(Boolean);
    r.observe(`${repo.name}: ${commits.length} commits changed boundaries.yaml`);

    for (const sha of commits) {
      // 初期設置は動きではない。親にバージョンが無いコミットがそれにあたる。
      const after = repo.git("show", `${sha}:boundaries.yaml`);
      const before = repo.git("show", `${sha}^:boundaries.yaml`);
      if (after === null) continue;
      if (before === null) {
        r.observe(`${sha.slice(0, 7)}: initial placement of the delegation table (not counted as a move)`);
        continue;
      }

      const moved = movedAreas(parseAreas(before), parseAreas(after));
      if (moved.length === 0) continue;

      const section = historySectionFor(history, sha, repo.git("log", "-1", "--format=%s", sha));
      if (section === null) {
        r.observe(`${sha.slice(0, 7)}: ${moved.join(", ")} moved, but it is not referenced from the history`);
        continue;
      }
      // **英語の `Ground` も根拠として読む**（AUT-264）。配布物の記入例は英語になった
      // （AUT-262）。日本語しか読まないと、案内どおりに書いたプロジェクトが「根拠が
      // 無い」と判定され、外側ループが一周したことにならない。
      if (!(section.includes("根拠") || /\bGround\b/.test(section))) {
        r.observe(`${sha.slice(0, 7)}: the history entry has no ground`);
        continue;
      }

      if (slug === null) {
        approvalUnreadable ??= `${repo.name}: no origin, so the fact of integration cannot be confirmed`;
        continue;
      }
      const res = await api.submissionsFor(slug, sha);
      if (!hasMergedSubmission(res)) {
        if (res.status === 200) {
          r.observe(`${sha.slice(0, 7)}: ${moved.join(", ")} moved, but it is not integrated yet`);
        } else {
          approvalUnreadable ??=
            `${slug}: response ${res.status} — cannot read the submission, so approval cannot be confirmed`;
        }
        continue;
      }

      qualified += 1;
      r.observe(`${sha.slice(0, 7)}: ${moved.join(", ")} moved, with both a ground and an integrated submission`);
    }
  }

  // 継続の閾値は定めない。定義§18が未確定としており、実データなしに決め打ちすると
  // 根拠の無い数字が残る。
  r.observe("Judging continuation is N/A (the threshold is decided from real data once starting is satisfied)");

  if (qualified === 0) {
    if (approvalUnreadable !== null) {
      // 代替ではなく、判定できていない。代替を添えて通すと両者が区別できなくなる。
      r.observe(approvalUnreadable);
      r.observe("A state that cannot be judged is itself treated as a failure (definition §9)");
      return r.conclude(UNSUBSTITUTED);
    }
    r.observe("There is no entry where a cell moved with both a ground and approval (the outer loop has not gone around once)");
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
      r.observe(`${repo.name}: no origin, so it cannot be confirmed whether changes went through submissions`);
      return null;
    }

    // 手元の設定を先に見る。無い場合だけ Repo に尋ねる。`git init` から作った
    // 作業ツリーには origin/HEAD が無く、そこで止めると誤警報になる。
    let branch = localDefaultBranch(repo);
    if (branch === null) branch = defaultBranchOf(await api.repository(slug));
    if (branch === null) {
      r.observe(`${repo.name}: cannot identify the default branch, so it cannot be confirmed whether changes went through submissions`);
      return null;
    }

    const candidates = directCommitCandidates(repo, branch);
    if (candidates === null) {
      r.observe(`${repo.name}: cannot read the history of ${branch}, so it cannot be confirmed whether changes went through submissions`);
      return null;
    }
    if (candidates.length === 0) continue;

    for (const c of candidates) {
      const res = await api.submissionsFor(slug, c.sha);
      if (hasMergedSubmission(res)) continue; // squash マージ等。提出を経ている
      if (res.status !== 200) {
        r.observe(`${slug}: response ${res.status} — cannot read submissions, so ${c.sha.slice(0, 7)} cannot be confirmed`);
        return null;
      }
      found.push(`${repo.name} ${c.sha.slice(0, 7)} ${c.subject}`);
    }
  }
  return found;
}

/**
 * 作業単位のIDらしきもの。**件名の中から拾う。**
 *
 * `AUT-123`・`AIEP-45` のどちらも取れる。Tracker の実装によって接頭辞は違うが、
 * **形は `<英大文字で始まる語>-<番号>` で共通である**（ADR 0013）。
 *
 * **ここで実装名を知らない。** 構成を読みに行くと、判定が構成に依存する。
 */
const WORK_ITEM_IN_SUBJECT = /\b[A-Z][A-Z0-9]*-\d+\b/;

export function workItemInSubject(subject) {
  return WORK_ITEM_IN_SUBJECT.exec(subject ?? "")?.[0] ?? null;
}

/**
 * 当該コミットに触れている委譲範囲の変更履歴の節。見つからなければ null。
 *
 * ## SHA だけで照合しない
 *
 * **squash / rebase で統合すると、既定ブランチ上の SHA が変わる。** 履歴が
 * 参照しているのはブランチ側の SHA であり、統合後は存在しない。
 *
 * ```
 * ブランチ側の SHA  20c0c44   ← 履歴に書かれた値
 * 統合後 main の SHA 5014785  ← 判定が照合する値
 * ```
 *
 * **落ちるのは統合の後である。** 提出の時点では通る。**通ったものが、統合した
 * 瞬間に落ちる**（AUT-240、GitHub #102）。
 *
 * そこで**作業単位のIDでも照合する。** IDは統合の仕方で変わらず、squash の既定の
 * 件名（提出の題）にも残る。**通信も要らない。**
 *
 * **SHA での照合は残す。** 既に書かれた履歴が動かなくなる。
 *
 * @param {string} history
 * @param {string} sha
 * @param {string | null} subject 当該コミットの件名
 */
function historySectionFor(history , sha, subject = null) {
  const short = sha.slice(0, 7);
  const workItem = workItemInSubject(subject);
  const sections = history.split(/^## /m).slice(1);
  for (const section of sections) {
    if (section.includes(sha) || section.includes(short)) return section;
    // **IDだけの節を、SHA の節と同じに扱う。** どちらもそのコミットを指している。
    if (workItem !== null && section.includes(workItem)) return section;
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
    r.observe("No Repo API token, so protection settings cannot be read (AUTODRIVE_CI_TOKEN not set)");
    r.observe("A state that cannot be judged is itself treated as a failure (definition §9)");
    return r.conclude(UNSUBSTITUTED);
  }

  const unprotected = [];
  const planLimited = [];
  const unreadable = [];

  for (const repo of repos) {
    const slug = repo.remoteSlug();
    if (slug === null) {
      unreadable.push(`${repo.name}: no origin, so the corresponding Repo cannot be identified`);
      continue;
    }
    const res = await api.rulesets(slug);
    if (res.status === 200) {
      const rules = Array.isArray(res.body) ? res.body : [];
      if (rules.length > 0) r.observe(`${slug}: ${rules.length} rulesets`);
      else unprotected.push(slug);
    } else if (isPlanLimited(res)) {
      planLimited.push(slug);
    } else {
      unreadable.push(`${slug}: response ${res.status}`);
    }
  }

  for (const slug of planLimited) {
    r.observe(`${slug}: 403 — a plan that cannot set rulesets on private repositories`);
  }
  for (const slug of unprotected) {
    r.observe(`${slug}: no rulesets at all (the default branch is not protected)`);
  }
  for (const msg of unreadable) r.observe(`Unreadable: ${msg}`);

  // **保護設定を持てなくても、破られたかどうかは見られる。** 段階0で検出による
  // 代替を選んだ以上、検出が無いまま規約だけで担保する状態を続けない。
  const direct = await directCommitsAcross(r, repos, api);
  if (direct === null) {
    r.observe("A state that cannot be judged is itself treated as a failure (definition §9)");
    return r.conclude(UNSUBSTITUTED);
  }
  if (direct.length > 0) {
    for (const line of direct.slice(0, 10)) r.observe(`Entered the default branch without a submission: ${line}`);
    if (direct.length > 10) r.observe(`...and ${direct.length - 10} more`);
    // 規約が破られている。代替が成立していないため、代替ありでは通さない。
    return r.conclude(UNSUBSTITUTED);
  }
  r.observe("Every change on the default branch entered through a submission");

  if (unreadable.length > 0) {
    r.observe("Some targets cannot be judged. Not passing (definition §9)");
    return r.conclude(UNSUBSTITUTED);
  }

  if (planLimited.length > 0 || unprotected.length > 0) {
    // 必須チェックの登録有無も ruleset に依存するため、ここでは判定できない。
    r.notImplemented(
      "Verifying that invariants is registered as a required check (no means of judging, since rulesets are unavailable)",
    );
    return substituted(r, events);
  }

  r.notImplemented("Verifying that the credentials given to the agent cannot change protection settings");
  r.observe("The default branch is protected in every repository");
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
