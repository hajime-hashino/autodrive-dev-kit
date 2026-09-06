/**
 * サンドボックス。
 *
 * **記録しているのに置いていない状態を作らない。** `autodrive.json` が
 * `sandbox: devcontainer` と言うなら、置かれること（AUT-95）。
 *
 * **許可する宛先は構成から決まる。** 使わないものへの穴を開けない。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { allowedDomains, destinationsFor } from "../src/sandbox.js";
import { NONE, defaults } from "../src/config.js";
import { setup } from "../src/setup.js";
import { featuresBlock, template } from "../src/init.js";
import { useRecommended } from "../src/ports/interview.js";
import { tempDir } from "./helpers/tmp.js";


const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project(name = "autodrive-sandbox-") {
  const root = tempDir(name);
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

/** 指定した答えを返す。 */
function answering(answers) {
  return { answer: (q) => answers[q.ask] ?? null };
}

// ---------------------------------------------------------------- 置くもの

test("構成がサンドボックスを使うなら、置く", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  for (const file of [
    "devcontainer.json",
    "init-firewall.sh",
    "post-create.sh",
    "check-setup.sh",
    "allowed-domains.txt",
    "README.md",
  ]) {
    assert.ok(existsSync(join(root, ".devcontainer", file)), `.devcontainer/${file} が無い`);
  }
});

// **使わないと決めたものを置かない。** 置くと、構成の記録と実物が食い違う。
test("使わないと決めたら、置かない", () => {
  const root = project();
  const port = answering({ "AIを、隔離された作業場の中で動かしますか？": NONE });
  const result = setup("init", root, KIT, port);

  assert.equal(existsSync(join(root, ".devcontainer")), false, "使わないのに置いている");
  // 構成にもそう残ること。
  assert.equal(result.config?.ports.sandbox, NONE);
});

// **記録と実物が一致すること。** ここが食い違うと、隔離されているつもりで
// 隔離されていない状態になる。
test("構成の記録と、置かれたものが一致する", () => {
  for (const [answer, shouldExist] of [
    ["devcontainer", true],
    [NONE, false],
  ] ) {
    const root = project();
    const port = answering({ "AIを、隔離された作業場の中で動かしますか？": answer });
    const result = setup("init", root, KIT, port);

    assert.equal(result.config?.ports.sandbox, answer);
    assert.equal(existsSync(join(root, ".devcontainer")), shouldExist, `${answer} で食い違っている`);
  }
});

// 作業場の名前が、そのプロジェクトのものになること。
test("作業場の名前が、プロジェクトのものになる", () => {
  const root = project("my-app-");
  setup("init", root, KIT, useRecommended);

  const json = readFileSync(join(root, ".devcontainer", "devcontainer.json"), "utf8");
  assert.ok(json.includes(`"name": "${join(root).split("/").pop()}"`), json.slice(0, 120));
  assert.equal(json.includes("{{NAME}}"), false, "置き換えが残っている");
  assert.equal(json.includes("{{KIT}}"), false, "置き換えが残っている");
});

// **この作業場に固有のものを配らない。** 子リポジトリが揃っているかを見る確認は、
// この作業場だけのものである。
test("この作業場に固有のものは配らない", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  assert.equal(existsSync(join(root, ".devcontainer", "check-workspace.sh")), false);
  const files = ["devcontainer.json", "post-create.sh", "allowed-domains.txt", "README.md"];
  for (const file of files) {
    const body = readFileSync(join(root, ".devcontainer", file), "utf8");
    for (const local of ["autodrive-dev-work", "agent-playground", "autodrive-dev-definition", "hajime"]) {
      assert.equal(body.includes(local), false, `${file} に「${local}」が入っている`);
    }
  }
});

// ---------------------------------------------------------------- 許可する宛先

// **どの構成でも要るものがある。** AIが動かなければ何も始まらない。
test("推論の宛先は、どの構成でも許す", () => {
  const bare = defaults();
  for (const port of Object.keys(bare.ports)) bare.ports[port ] = NONE;

  const hosts = destinationsFor(bare).map((d) => d.host);
  assert.ok(hosts.includes("api.anthropic.com"), hosts.join(", "));
});

// **使わないものへの穴を開けない。** 構成に無い宛先は入らない。
test("使わないポートの宛先は、許さない", () => {
  const config = defaults();
  config.ports.preview = NONE;
  config.ports.tracker = NONE;

  const hosts = destinationsFor(config).map((d) => d.host);
  assert.equal(hosts.includes("api.cloudflare.com"), false, "使わないプレビューの宛先が入っている");
  assert.equal(hosts.includes("api.linear.app"), false, "使わない作業単位の宛先が入っている");
  // 使うものは入ること。
  assert.ok(hosts.includes("github.com"));
});

test("使うポートの宛先は、許す", () => {
  const config = defaults();
  config.ports.preview = "cloudflare-workers";
  const hosts = destinationsFor(config).map((d) => d.host);
  assert.ok(hosts.includes("api.cloudflare.com"));
  // **仕様を確かめる先も要る。** 記憶で答えないため。
  assert.ok(hosts.includes("developers.cloudflare.com"));
});

// **2つのポートが同じ実装を使うことがある。** 作業単位の場所を GitHub にすれば、
// Repo と同じ宛先が要る。落とさないと同じ行が2つ並ぶ。
test("同じ宛先を二重に並べない", () => {
  const hosts = destinationsFor(defaults()).map((d) => d.host);
  assert.equal(new Set(hosts).size, hosts.length, hosts.join(", "));

  const shared = defaults();
  shared.ports.tracker = "github";
  const twice = destinationsFor(shared).map((d) => d.host);
  assert.equal(new Set(twice).size, twice.length, `二重に並んでいる: ${twice.join(", ")}`);
  assert.ok(twice.includes("github.com"));
});

// **なぜ要るのかを併記する。** 書けないなら要らない可能性が高い。後から読む人が
// 消してよいかを判断できる。
test("宛先には、なぜ要るのかが書いてある", () => {
  for (const d of destinationsFor(defaults())) {
    assert.ok(d.why.trim().length > 0, `${d.host} に理由が無い`);
  }
  const text = allowedDomains(defaults());
  for (const d of destinationsFor(defaults())) {
    assert.ok(text.includes(`${d.host} `) || text.includes(`${d.host}  #`), `${d.host} が一覧に無い`);
    assert.ok(text.includes(d.why), `${d.host} の理由が一覧に無い`);
  }
});

// **ワイルドカードは書けない。** 規則は名前解決した IP に対して置かれる。
// 書けると思って書かれると、出られない理由が分からなくなる。
test("ワイルドカードが書けないことを、一覧の中で伝える", () => {
  assert.ok(allowedDomains(defaults()).includes("ワイルドカードは書けない"));
});

// **構成から作られていることを、読む人に伝える。** 手で足したものが、次の
// 入れ替えで消えることに気づけない。
test("構成から作られていることを、一覧の中で伝える", () => {
  const text = allowedDomains(defaults());
  assert.ok(text.includes("autodrive.json"), text.slice(0, 600));
  assert.ok(text.includes("update"), text.slice(0, 600));
});

// **支度が呼ぶものが、置かれていること。** 呼び先が無いと、確認が黙って走らなく
// なる（`|| true` で失敗も飲み込まれる）。**捕まえられない仕掛けになる。**
test("支度が呼ぶ手順が、すべて置かれている", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  const dir = join(root, ".devcontainer");
  const post = readFileSync(join(dir, "post-create.sh"), "utf8");
  const called = [...post.matchAll(/([\w-]+\.sh)/g)].map((m) => m[1]);

  assert.ok(called.length > 0, "呼んでいる手順を拾えていない");
  for (const script of new Set(called)) {
    assert.ok(existsSync(join(dir, script)), `post-create.sh が呼ぶ ${script} が置かれていない`);
  }
});

// 環境の定義が呼ぶものも、同じ理由で置かれていること。
test("環境の定義が呼ぶ手順が、すべて置かれている", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  const dir = join(root, ".devcontainer");
  const json = readFileSync(join(dir, "devcontainer.json"), "utf8");
  const called = [...json.matchAll(/\.devcontainer\/([\w-]+\.sh)/g)].map((m) => m[1]);

  assert.ok(called.length > 0, "呼んでいる手順を拾えていない");
  for (const script of new Set(called)) {
    assert.ok(existsSync(join(dir, script)), `devcontainer.json が呼ぶ ${script} が置かれていない`);
  }
});

// ---------------------------------------------------------------- 使えと言う

// **置いたものを使えと言う。** 開き直さなければ、隔離されていない場所でAIが動く。
// 構成は隔離すると記録しているのに、実際には隔離されない（AUT-99）。
test("作業場を置いたなら、開き直せと言う", () => {
  // **中にいるかを差し込む。** 実行する場所で結果が変わると、判定にならない。
  const result = setup("init", project(), KIT, useRecommended, false);
  const said = result.todo.join("\n");

  assert.ok(said.includes("Reopen in Container"), said);
  // **`.env` の後に言う。** 支度は環境を作るときに .env を読む。先に開き直すと、
  // 資格情報が入らないまま作業場ができる。
  assert.ok(said.indexOf(".env を作り") < said.indexOf("Reopen in Container"), said);
  assert.ok(said.includes(".env を作ってから"), "順序の理由が書かれていない");
});

// **Claude Code を開くのは、開き直した後である。**
test("開き直してから、AIに話しかける順で言う", () => {
  const said = setup("init", project(), KIT, useRecommended, false).todo.join("\n");
  assert.ok(said.indexOf("Reopen in Container") < said.indexOf("Claude Code"), said);
});

// **使わないと決めたなら、言わない。** 置いていないものを開けとは言えない。
test("作業場を使わないなら、開き直せと言わない", () => {
  const port = answering({ "AIを、隔離された作業場の中で動かしますか？": NONE });
  const said = setup("init", project(), KIT, port, false).todo.join("\n");
  assert.equal(said.includes("Reopen in Container"), false, said);
});

// **中にいるなら言わない。** 済んでいることを頼まない。
test("作業場の中で打ったなら、開き直せと言わない", () => {
  const said = setup("init", project(), KIT, useRecommended, true).todo.join("\n");
  assert.equal(said.includes("Reopen in Container"), false, said);
});

// **置き場所の作成とシークレットの登録は、AIの仕事である**（AUT-100）。
// 人の一覧に書くと、AIが動き始める前に読まれ、人の作業になる。
test("AIにできることを、人の一覧に書かない", () => {
  const said = setup("init", project(), KIT, useRecommended, false).todo.join("\n");

  for (const ai of ["置き場所を作り", "gh repo create", "AUTODRIVE_CI_TOKEN を登録"]) {
    assert.equal(said.includes(ai), false, `AIにできることを人に振っている: ${ai}`);
  }
  // 残るのは、AIに実行できないものだけ。
  assert.ok(said.includes(".env"), said);
  assert.ok(said.includes("Reopen in Container"), said);
});

// **代わりに、配る規約がAIに指示していること。** 人の一覧から外しただけで
// どこにも書かれていなければ、誰もやらない。
test("置き場所とシークレットは、AIの手順として配られている", () => {
  const rules = readFileSync(join(KIT, "templates", "autodrive.md"), "utf8");
  const section = rules.slice(rules.indexOf("### 4. "), rules.indexOf("### 5. "));

  // **表の行として在ること。** 本文で触れているだけでは、確かめる手順にならない。
  const rows = section.split("\n").filter((l) => l.startsWith("|"));
  assert.ok(
    rows.some((l) => l.includes("置き場所") && l.includes("遠隔")),
    `置き場所を確かめる行が無い:\n${rows.join("\n")}`,
  );
  assert.ok(
    rows.some((l) => l.includes("資格情報が登録されているか")),
    `資格情報を確かめる行が無い:\n${rows.join("\n")}`,
  );
  // **名前は人が決める。作るのは手順である。**
  assert.ok(section.includes("名前は人が決める"), section.slice(0, 900));
  // **API を呼べば済むものを人に振らない**という指示があること。
  assert.ok(section.includes("API を呼べば済むもの"), section.slice(0, 900));
});

// -------------------------------------------- アプリ自身の宛先（AUT-115）

/** アプリ自身の宛先を持つ構成。 */
function withDest(destinations) {
  const config = defaults();
  config.app.destinations = destinations;
  return config;
}

const STRIPE = { host: "api.stripe.com", why: "決済。このアプリが叩く" };

test("アプリ自身の宛先が、一覧に入る", () => {
  const found = destinationsFor(withDest([STRIPE])).find((d) => d.host === STRIPE.host);
  assert.ok(found !== undefined, "アプリの宛先が落ちている");
  assert.equal(found.ofApp, true, "アプリのものだと分かる印が無い");
});

test("アプリ自身の宛先が、許可一覧に出る", () => {
  const text = allowedDomains(withDest([STRIPE]));
  assert.ok(text.includes("api.stripe.com"), "宛先が出ていない");
  assert.ok(text.includes(STRIPE.why), "なぜ要るのかが出ていない");
});

// **どこまでが道具の都合で開いている穴かを分ける。**
test("アプリ自身のものは、道具のものと混ざらない", () => {
  const text = allowedDomains(withDest([STRIPE]));
  assert.ok(text.includes("このプロジェクト自身の宛先"), "見出しが無い");
  assert.ok(
    text.indexOf("api.stripe.com") > text.indexOf("このプロジェクト自身の宛先"),
    "見出しより前に出ている",
  );
  assert.ok(text.indexOf("api.github.com") < text.indexOf("このプロジェクト自身の宛先"));
});

test("1つも無ければ、見出しも出さない", () => {
  assert.equal(allowedDomains(defaults()).includes("このプロジェクト自身の宛先"), false);
});

// **書けと言った場所が、書いたものを消していた。** 二度と言わないこと。
test("許可一覧へ直接足せ、とは言わない", () => {
  const text = allowedDomains(defaults());
  assert.equal(text.includes("ここへ足すこと"), false, "消える場所へ足せと言っている");
  assert.ok(text.includes("直接編集しないこと"), "直接編集するなと言っていない");
  assert.ok(text.includes("app.destinations"), "どこに書けばよいかが出ていない");
});

test("道具の宛先と同じものは、二重に出さない", () => {
  const config = withDest([{ host: "api.github.com", why: "重なった" }]);
  const hosts = destinationsFor(config).map((d) => d.host);
  assert.equal(hosts.filter((h) => h === "api.github.com").length, 1, "同じ宛先が2行出る");
});

// **説明の側も直っていること。** 仕掛けを入れても、古い指示が残れば人はそれに従う。
test("配る説明が、消える場所へ足せと言っていない", () => {
  const readme = readFileSync(join(KIT, "templates", "devcontainer", "README.md"), "utf8");
  assert.equal(readme.includes("決まった時点で人が足す"), false, "消える場所へ足せと言っている");
  assert.ok(readme.includes("app.destinations"), "どこに書けばよいかが出ていない");
  assert.ok(readme.includes("直接編集しないこと"), "直接編集するなと言っていない");
});

// ------------------------------------------- 出口が起動のたびに閉じるか（AUT-121）

/**
 * 配る devcontainer の設定。
 *
 * **コメントと差し込み口を外してから読む。** 素の `JSON.parse` は通らない。
 */
function devcontainerJson() {
  const raw = template(KIT, "devcontainer/devcontainer.json", { NAME: "x", APP_FEATURES: "" });
  return JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));
}

// **規則はコンテナの停止で消える。** 作ったときにしか走らない契機へ置くと、
// 1回目の起動以降は隔離が無い。実際に10日間そうなっていた。
test("出口を閉じる手順は、起動のたびに走る契機に置かれている", () => {
  const dc = devcontainerJson();
  assert.ok(
    (dc.postStartCommand ?? "").includes("init-firewall.sh"),
    `起動のたびに走らない: postStart=${dc.postStartCommand}`,
  );
});

test("出口を閉じる手順を、作成時だけの契機に置かない", () => {
  const dc = devcontainerJson();
  assert.equal(
    (dc.postCreateCommand ?? "").includes("init-firewall.sh"),
    false,
    "作成時にしか走らない契機に置いている",
  );
});

// **root が要る。** エージェントは root で動かさないため、sudo を通す。
test("出口を閉じる手順は、権限を持って走る", () => {
  assert.ok(devcontainerJson().postStartCommand.includes("sudo"), "権限が足りない");
});

// **支度は作ったときだけでよい。** 起動のたびに走らせる必要は無い。
test("支度は作成時の契機に残っている", () => {
  assert.ok(devcontainerJson().postCreateCommand.includes("post-create.sh"));
});

// **効いていないことに気づける最後の網。** 起動時の手順が走らなかった場合に効く。
test("支度の確認が、出口の状態を見る", () => {
  const sh = readFileSync(join(KIT, "templates", "devcontainer", "check-setup.sh"), "utf8");
  assert.ok(sh.includes("出口制限が効いていない"), "効いていないことを言わない");
  assert.ok(sh.includes("init-firewall.sh"), "どう直すかを出していない");
});

// --------------------------- 出口制限は閉じる仕掛けではない（AUT-122）

// **「ここに無い宛先へは出られない」と書いていた。嘘だった。**
// 出口制限が効いている状態で、一覧に無い raw.githubusercontent.com へ出られる。
// 許可している objects.githubusercontent.com と同じ IP のため。
test("一覧に無い宛先へ出られないとは、書かない", () => {
  const text = allowedDomains(defaults());
  assert.equal(text.includes("ここに無い宛先へは出られない"), false, "嘘を書いている");
  assert.ok(text.includes("ただし全部ではない"), "限界を書いていない");
});

test("同じ IP を共有する宛先へは出られることを、実例つきで書く", () => {
  const text = allowedDomains(defaults());
  assert.ok(text.includes("同じ IP を"), "理由が無い");
  assert.ok(text.includes("raw.githubusercontent.com"), "実例が無い");
});

// **保証として扱わせない。** 扱うと、他の守りを弱める理由に使われる。
test("データが外へ出ない保証ではない、と書く", () => {
  const text = allowedDomains(defaults());
  assert.ok(text.includes("保証として扱わないこと"), "保証でないと言っていない");
  assert.ok(text.includes("本当に守っているのは"), "何が守っているかを言っていない");
});

test("配布物と devcontainer の説明も、同じことを言っている", () => {
  const readme = readFileSync(join(KIT, "templates", "devcontainer", "README.md"), "utf8");
  assert.equal(readme.includes("無い宛先へは\n出られない"), false, "説明に嘘が残っている");
  assert.ok(readme.includes("閉じる仕掛けではなく、減らす仕掛け"), "限界を書いていない");
});

// ------------------------- IP が入れ替わる宛先（AUT-63）

const firewall = () =>
  readFileSync(join(KIT, "templates", "devcontainer", "init-firewall.sh"), "utf8");

// **置いたままだと静かに出られなくなる。** 19宛先のうち2つが数時間でズレた。
test("引き直す口がある", () => {
  const sh = firewall();
  assert.ok(sh.includes('"${1:-}" = "--refresh"'), "引き直す口が無い");
  assert.ok(sh.includes("REFRESH_INTERVAL"), "定期的に回す仕掛けが無い");
});

// **丸ごと置き直さない。** `-F` の瞬間に、通っている接続の戻りを許す規則も消える。
test("引き直しは足すだけで、置き直さない", () => {
  const refresh = firewall().split('"${1:-}" = "--refresh"')[1]?.split("\nfi\n")[0] ?? "";
  assert.equal(refresh.includes("iptables -F"), false, "引き直しで丸ごと消している");
  assert.ok(firewall().includes("iptables -C OUTPUT"), "既にある規則を確かめていない");
});

// **閉じていないのに「引き直した」と言わせない。**
test("閉じていなければ、引き直しを拒む", () => {
  assert.ok(firewall().includes("出口が閉じていない"), "開いた状態で通してしまう");
});

// **名前で探して落とす形にしない。** 実際に、確認していたシェルを落とした。
test("背後の処理は PID で止める。名前で探して落とさない", () => {
  // **説明の中の言及と、実際の使用を分ける。** 使わない理由を書いてあるだけの行を
  // 使用として数えると、書けば書くほど落ちる判定になる。
  const used = firewall()
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
  assert.equal(used.includes("pkill"), false, "無関係な処理まで巻き込む形になっている");
  assert.ok(used.includes("PIDFILE"), "止める相手を特定していない");
});

// **一覧に無い名前を足す経路を作らない。** そこが絞る目的と衝突する。
test("引き直す対象が、一覧にある名前に限られている", () => {
  const sh = firewall();
  assert.ok(sh.includes('done < "$ALLOWED"'), "一覧以外から名前を取っている");
  assert.ok(sh.includes("一覧にある名前だけ"), "その意図が書かれていない");
});

// ------------------------- 作業場に足す道具（AUT-132）

/** 差し込んだ結果の devcontainer.json。**コメントを外して読む。** */
function rendered(features) {
  const config = defaults();
  config.app.devcontainer_features = features;
  const text = template(KIT, "devcontainer/devcontainer.json", {
    NAME: "x",
    APP_FEATURES: featuresBlock(config),
  });
  return { text, json: JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) };
}

test("足した道具が、作業場の定義に入る", () => {
  const { json } = rendered([
    { id: "ghcr.io/devcontainers/features/docker-in-docker:2", options: {}, why: "配布前に確かめる" },
  ]);
  assert.ok(
    json.features["ghcr.io/devcontainers/features/docker-in-docker:2"] !== undefined,
    "入っていない",
  );
  // 元から入っているものを消さない。
  assert.ok(json.features["ghcr.io/devcontainers/features/node:1"] !== undefined, "元の道具が消えた");
});

test("値のある options も渡る", () => {
  const { json } = rendered([{ id: "a/b:1", options: { version: "2" }, why: "理由" }]);
  assert.deepEqual(json.features["a/b:1"], { version: "2" });
});

// **JSON として壊さない。** 差し込みは読点の位置を間違えやすい。
test("足しても足さなくても、読める形になる", () => {
  for (const feats of [
    [],
    [{ id: "a/b:1", options: {}, why: "1つ" }],
    [{ id: "a/b:1", options: {}, why: "1つ目" }, { id: "c/d:2", options: {}, why: "2つ目" }],
  ]) {
    assert.doesNotThrow(() => rendered(feats), `${feats.length} 件で壊れる`);
  }
});

// **雛形のコメントを壊さない。** 読んで書き戻すと、判断の理由が消える。
test("雛形に書かれた理由が残る", () => {
  const { text } = rendered([{ id: "a/b:1", options: {}, why: "理由" }]);
  for (const must of ["外向き通信を絞るために要る", "出口を閉じるのは、起動のたびに行う"]) {
    assert.ok(text.includes(must), `消えた: ${must}`);
  }
});

// **なぜ足したかを、置いた場所に残す。** 後から消してよいか判断できる。
test("なぜ要るのかが、置いた場所に書かれる", () => {
  const { text } = rendered([{ id: "a/b:1", options: {}, why: "配布前に確かめるため" }]);
  assert.ok(text.includes("配布前に確かめるため"), "理由が残っていない");
  assert.ok(text.includes("app.devcontainer_features"), "どこに書けばよいかが出ていない");
});

test("足していなければ、見出しも出さない", () => {
  assert.equal(rendered([]).text.includes("このプロジェクトが足したもの"), false);
});
