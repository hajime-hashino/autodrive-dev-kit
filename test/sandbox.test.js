/**
 * サンドボックス。
 *
 * **記録しているのに置いていない状態を作らない。** `autodrive.json` が
 * `sandbox: devcontainer` と言うなら、置かれること（AUT-95）。
 *
 * **許可する宛先は構成から決まる。** 使わないものへの穴を開けない。
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { allowedDomains, destinationsFor } from "../src/vendored/internal/sandbox.js";
import { NONE, defaults } from "../src/vendored/internal/config.js";
import { setup } from "../src/vendored/internal/setup.js";
import { template } from "../src/vendored/internal/init.js";
import { useRecommended } from "../src/vendored/internal/ports/interview.js";
import { tempDir } from "./helpers/tmp.js";


const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function project(name = "autodrive-sandbox-") {
  const root = tempDir(name);
  mkdirSync(join(root, ".git"), { recursive: true });
  return root;
}

/**
 * 指定した答えを返す。
 *
 * **ポートの名前で引く。問いの文で引かない。** 文で引いていたところ、問いを
 * 言い換えた時点で当たらなくなり、**答えたはずのものが推奨に倒れた**（AUT-218）。
 * 落ちたから気づいたが、落ち方は「置いていないはずのものが置かれている」であり、
 * 原因から遠い。
 */
function answering(answers) {
  return { answer: (q) => answers[q.port] ?? null };
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
  const port = answering({ sandbox: NONE });
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
    const port = answering({ sandbox: answer });
    const result = setup("init", root, KIT, port);

    assert.equal(result.config?.ports.sandbox, answer);
    assert.equal(existsSync(join(root, ".devcontainer")), shouldExist, `${answer} で食い違っている`);
  }
});

// サンドボックスの名前が、そのプロジェクトのものになること。
test("サンドボックスの名前が、プロジェクトのものになる", () => {
  const root = project("my-app-");
  setup("init", root, KIT, useRecommended);

  const json = readFileSync(join(root, ".devcontainer", "devcontainer.json"), "utf8");
  assert.ok(json.includes(`"name": "${join(root).split("/").pop()}"`), json.slice(0, 120));
  assert.equal(json.includes("{{NAME}}"), false, "置き換えが残っている");
  assert.equal(json.includes("{{KIT}}"), false, "置き換えが残っている");
});

// **このワークディレクトリに固有のものを配らない。** 子リポジトリが揃っているかを見る確認は、
// このワークディレクトリだけのものである。
test("このワークディレクトリに固有のものは配らない", () => {
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
  assert.ok(allowedDomains(defaults()).includes("Wildcards cannot be written"));
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
test("サンドボックスを置いたなら、開き直せと言う", () => {
  // **中にいるかを差し込む。** 実行する場所で結果が変わると、判定にならない。
  const result = setup("init", project(), KIT, useRecommended, false);
  const said = result.todo.join("\n");

  assert.ok(said.includes("Reopen in Container"), said);
  // **`.env` の後に言う。** 支度は環境を作るときに .env を読む。先に開き直すと、
  // 資格情報が入らないままサンドボックスができる。
  assert.ok(said.indexOf(".env を作り") < said.indexOf("Reopen in Container"), said);
  assert.ok(said.includes(".env を作ってから"), "順序の理由が書かれていない");
});

// **Claude Code を開くのは、開き直した後である。**
test("開き直してから、AIに話しかける順で言う", () => {
  const said = setup("init", project(), KIT, useRecommended, false).todo.join("\n");
  assert.ok(said.indexOf("Reopen in Container") < said.indexOf("Claude Code"), said);
});

// **使わないと決めたなら、言わない。** 置いていないものを開けとは言えない。
test("サンドボックスを使わないなら、開き直せと言わない", () => {
  const port = answering({ sandbox: NONE });
  const said = setup("init", project(), KIT, port, false).todo.join("\n");
  assert.equal(said.includes("Reopen in Container"), false, said);
});

// **中にいるなら言わない。** 済んでいることを頼まない。
test("サンドボックスの中で打ったなら、開き直せと言わない", () => {
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
  const rules = readFileSync(join(KIT, "src", "templates", "autodrive.md"), "utf8");
  // **節の切り方に依らない。** 立ち上げの段取りを表にまとめたので、番号付きの
  // 小見出しは無い。確かめる行が在ることだけを見る。
  const section = rules;

  // **表の行として在ること。** 本文で触れているだけでは、確かめる手順にならない。
  const rows = section.split("\n").filter((l) => l.startsWith("|"));
  assert.ok(
    rows.some((l) => l.includes("Repo has a place") && l.includes("remote")),
    `置き場所を確かめる行が無い:\n${rows.join("\n")}`,
  );
  assert.ok(
    rows.some((l) => l.includes("credentials CI uses for checks are registered")),
    `資格情報を確かめる行が無い:\n${rows.join("\n")}`,
  );
  // **名前は人が決める。作るのは手順である。**
  assert.ok(section.includes("The human decides the name"), section.slice(0, 900));
  // **API を呼べば済むものを人に振らない**という指示があること。
  assert.ok(section.includes("calling an API would settle"), section.slice(0, 900));
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
  assert.equal(found.ofApp, true, "アプリのものだと分かる見出しが無い");
});

test("アプリ自身の宛先が、許可一覧に出る", () => {
  const text = allowedDomains(withDest([STRIPE]));
  assert.ok(text.includes("api.stripe.com"), "宛先が出ていない");
  assert.ok(text.includes(STRIPE.why), "なぜ要るのかが出ていない");
});

// **どこまでが autodrive-dev-kit の都合で開いている穴かを分ける。**
test("アプリ自身のものは、autodrive-dev-kit のものと混ざらない", () => {
  const text = allowedDomains(withDest([STRIPE]));
  assert.ok(text.includes("this project's own destinations"), "見出しが無い");
  assert.ok(
    text.indexOf("api.stripe.com") > text.indexOf("this project's own destinations"),
    "見出しより前に出ている",
  );
  assert.ok(text.indexOf("api.github.com") < text.indexOf("this project's own destinations"));
});

test("1つも無ければ、見出しも出さない", () => {
  assert.equal(allowedDomains(defaults()).includes("this project's own destinations"), false);
});

// **書けと言った場所が、書いたものを消していた。** 二度と言わないこと。
test("許可一覧へ直接足せ、とは言わない", () => {
  const text = allowedDomains(defaults());
  assert.equal(text.includes("add them here"), false, "消える場所へ足せと言っている");
  assert.ok(text.includes("do not edit this file directly"), "直接編集するなと言っていない");
  assert.ok(text.includes("app.destinations"), "どこに書けばよいかが出ていない");
});

test("autodrive-dev-kit の宛先と同じものは、二重に出さない", () => {
  const config = withDest([{ host: "api.github.com", why: "重なった" }]);
  const hosts = destinationsFor(config).map((d) => d.host);
  assert.equal(hosts.filter((h) => h === "api.github.com").length, 1, "同じ宛先が2行出る");
});

// **説明の側も直っていること。** 仕掛けを入れても、古い指示が残れば人はそれに従う。
test("配る説明が、消える場所へ足せと言っていない", () => {
  const readme = readFileSync(join(KIT, "src", "templates", "devcontainer", "README.md"), "utf8");
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

// **規則はコンテナの停止で消える。** 作ったときにしか走らないフックへ置くと、
// 1回目の起動以降は隔離が無い。実際に10日間そうなっていた。
test("出口を閉じる手順は、起動のたびに走るフックに置かれている", () => {
  const dc = devcontainerJson();
  assert.ok(
    (dc.postStartCommand ?? "").includes("init-firewall.sh"),
    `起動のたびに走らない: postStart=${dc.postStartCommand}`,
  );
});

test("出口を閉じる手順を、作成時だけのフックに置かない", () => {
  const dc = devcontainerJson();
  assert.equal(
    (dc.postCreateCommand ?? "").includes("init-firewall.sh"),
    false,
    "作成時にしか走らないフックに置いている",
  );
});

// **root が要る。** エージェントは root で動かさないため、sudo を通す。
test("出口を閉じる手順は、権限を持って走る", () => {
  assert.ok(devcontainerJson().postStartCommand.includes("sudo"), "権限が足りない");
});

// **支度は作ったときだけでよい。** 起動のたびに走らせる必要は無い。
test("支度は作成時のフックに残っている", () => {
  assert.ok(devcontainerJson().postCreateCommand.includes("post-create.sh"));
});

// **効いていないことに気づける最後の網。** 起動時の手順が走らなかった場合に効く。
test("支度の確認が、出口の状態を見る", () => {
  const sh = readFileSync(join(KIT, "src", "templates", "devcontainer", "check-setup.sh"), "utf8");
  assert.ok(sh.includes("出口制限が効いていない"), "効いていないことを言わない");
  assert.ok(sh.includes("init-firewall.sh"), "どう直すかを出していない");
});

// ------------------------------------------ 確認は閉じたあとに走る（AUT-169）

// **網が、閉じる前に置かれていた。** 確認は post-create.sh から呼ばれており、
// つまり postCreateCommand で走る。devcontainer は postCreate → postStart の順に
// 走るため、**確認の時点では必ず規則が無い。** 配った先すべてで、環境を作り直す
// たびに「出口制限が効いていない」と誤って報告していた。
test("支度の確認は、出口を閉じたあとに走る", () => {
  const dc = devcontainerJson();
  const cmd = dc.postStartCommand ?? "";
  assert.ok(cmd.includes("check-setup.sh"), `確認の機会が無い: postStart=${cmd}`);
  // **順序まで見る。** 同じ行にあっても、確認が先なら閉じる前に走る。
  assert.ok(
    cmd.indexOf("init-firewall.sh") < cmd.indexOf("check-setup.sh"),
    `確認が init-firewall.sh より先に走る: ${cmd}`,
  );
});

// **直接でも、post-create.sh 経由でも同じである。** AUT-169 は後者だった。
test("支度の確認を、作成時だけのフックから呼ばない", () => {
  const dc = devcontainerJson();
  assert.equal(
    (dc.postCreateCommand ?? "").includes("check-setup.sh"),
    false,
    "作成時のフックが確認を直接呼んでいる。**出口を閉じる前に走る**",
  );

  const sh = readFileSync(join(KIT, "src", "templates", "devcontainer", "post-create.sh"), "utf8");
  const body = sh
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  assert.equal(
    body.includes("check-setup.sh"),
    false,
    "post-create.sh が確認を呼んでいる。**出口を閉じる前に走る**（AUT-169）",
  );
});

// **出られないことは、閉じていることの根拠にならない。** curl が無くても、通信
// そのものが落ちていても、規則が厳しすぎても、同じように出られない。直す前は
// そのすべてを「効いている」と読んでいた。**確かめられないことを、正しいことに
// していた。**
test("確かめられないことを、効いていることにしない", () => {
  const sh = readFileSync(join(KIT, "src", "templates", "devcontainer", "check-setup.sh"), "utf8");
  assert.ok(sh.includes("command -v curl"), "確かめる道具があるかを見ていない");
  assert.ok(sh.includes("確かめられない"), "確かめられない場合を言い分けていない");
  // **許可した宛先へ届くことまで見て、初めて「閉じている」と言える。**
  assert.ok(sh.includes("api.github.com"), "許可した宛先の側を見ていない");
});

// --------------------------- 出口制限は閉じる仕掛けではない（AUT-122）

// **「ここに無い宛先へは出られない」と書いていた。嘘だった。**
// 出口制限が効いている状態で、一覧に無い raw.githubusercontent.com へ出られる。
// 許可している objects.githubusercontent.com と同じ IP のため。
test("一覧に無い宛先へ出られないとは、書かない", () => {
  const text = allowedDomains(defaults());
  assert.equal(text.includes("destinations not listed here cannot be reached"), false, "嘘を書いている");
  assert.ok(text.includes("But not all"), "限界を書いていない");
});

test("同じ IP を共有する宛先へは出られることを、実例つきで書く", () => {
  const text = allowedDomains(defaults());
  assert.ok(text.includes("share an IP"), "理由が無い");
  assert.ok(text.includes("raw.githubusercontent.com"), "実例が無い");
});

// **保証として扱わせない。** 扱うと、他の守りを弱める理由に使われる。
test("データが外へ出ない保証ではない、と書く", () => {
  const text = allowedDomains(defaults());
  assert.ok(text.includes("Do not treat this as a guarantee"), "保証でないと言っていない");
  assert.ok(text.includes("What actually protects"), "何が守っているかを言っていない");
});

test("配布物と devcontainer の説明も、同じことを言っている", () => {
  const readme = readFileSync(join(KIT, "src", "templates", "devcontainer", "README.md"), "utf8");
  assert.equal(readme.includes("無い宛先へは\n出られない"), false, "説明に嘘が残っている");
  assert.ok(
    readme.includes("通信を遮断する仕組みではなく、出られる先を減らす仕組み"),
    "限界を書いていない",
  );
});

// ------------------------- IP が入れ替わる宛先（AUT-63）

const firewall = () =>
  readFileSync(join(KIT, "src", "templates", "devcontainer", "init-firewall.sh"), "utf8");

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

// ------------------------- サンドボックスの定義は、プロジェクトのもの（AUT-157）

// **差し込み口を持たない。** app.devcontainer_features は撤去した。足したい機能は
// devcontainer.json へ直接書く。守るのは所有権ではなく、隔離の判定である。
test("差し込み口の置き換えが、テンプレートに残っていない", () => {
  const text = template(KIT, "devcontainer/devcontainer.json", { NAME: "x" });
  assert.equal(text.includes("{{APP_FEATURES}}"), false, "置き換えが残っている");
  assert.equal(text.includes("{{"), false, `置き換えが残っている: ${text.slice(0, 200)}`);
});

// **プロジェクトのものであることが、置いた先に書かれていること。** 触ってよいと
// 分からなければ、結局こちらへ聞きに来ることになる。
test("触ってよいことが、置いた場所に書かれている", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  const text = readFileSync(join(root, ".devcontainer", "devcontainer.json"), "utf8");
  assert.ok(text.includes("プロジェクトのもの"), "誰のものかが書かれていない");
  assert.ok(text.includes("invariants"), "外したときに何が起きるかが書かれていない");
});

// **触ってよくても、隔離は残ること。** 直接編集しても update は止まらない。
test("直接編集しても、update は止まらない", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  const path = join(root, ".devcontainer", "devcontainer.json");
  const before = readFileSync(path, "utf8");
  writeFileSync(path, before.replace('"remoteUser": "vscode",', '"remoteUser": "vscode",\n  "forwardPorts": [5432],'));

  const r = setup("update", root, KIT, useRecommended);

  assert.equal(r.code, 0, r.message ?? "");
  // **書き換えないこと。** 持ち主はプロジェクトである。
  assert.ok(readFileSync(path, "utf8").includes("forwardPorts"), "上書きされた");
});

// ------------------------- devcontainer-lock.json は管理下から外れる（AUT-153）

// **足した機能を作り直すと、CLI がバージョンを解決して lock を書き込む。** そこは
// `(テンプレート, 構成)` だけでは決まらないため、他の管理下ファイルと同じ扱いにすると
// 「手で変えられている」と誤って判定され、update が止まる。ここでは実際に
// setup("update", ...) を通し、その誤判定が起きないことを確かめる。
test("lock を CLI が書き換えても、update は止まらない", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  const lock = join(root, ".devcontainer", "devcontainer-lock.json");
  const before = JSON.parse(readFileSync(lock, "utf8"));
  before.features["ghcr.io/devcontainers/features/docker-in-docker:2"] = {
    version: "2.17.0",
    resolved: "ghcr.io/devcontainers/features/docker-in-docker@sha256:dummy",
    integrity: "sha256:dummy",
  };
  writeFileSync(lock, JSON.stringify(before, null, 2));

  const r = setup("update", root, KIT, useRecommended);
  assert.equal(r.code, 0, r.message ?? "");
  assert.equal((r.message ?? "").includes("手で変えられている"), false, r.message ?? "");

  // **書き込んだ内容が消えていないこと。** 止まらないだけでなく、上書きもしない。
  const after = JSON.parse(readFileSync(lock, "utf8"));
  assert.ok(after.features["ghcr.io/devcontainers/features/docker-in-docker:2"] !== undefined, "上書きされた");
});

// **組み込みの3つだけの、素のプロジェクトでも起きる。** 機能を1つも足していなくても、
// 上流のバージョンが動けば CLI は lock を書き換える。devcontainer_features の有無とは
// 関係がないことを、ここで確かめる。
test("機能を足していなくても、lock の書き換えで update は止まらない", () => {
  const root = project();
  setup("init", root, KIT, useRecommended);

  const lock = join(root, ".devcontainer", "devcontainer-lock.json");
  const before = JSON.parse(readFileSync(lock, "utf8"));
  before.features["ghcr.io/devcontainers/features/node:1"].version = "1.7.2";
  writeFileSync(lock, JSON.stringify(before, null, 2));

  const r = setup("update", root, KIT, useRecommended);
  assert.equal(r.code, 0, r.message ?? "");
});

// **播種であって、消せるものではない。** サンドボックスを使わないプロジェクトに
// 置いてはいけない。
test("サンドボックスを使わないなら、lock も置かない", () => {
  const root = project();
  const port = answering({ sandbox: NONE });
  setup("init", root, KIT, port);

  assert.equal(existsSync(join(root, ".devcontainer", "devcontainer-lock.json")), false);
});
