/**
 * 許可した宛先へ、いま本当に出られるか。
 *
 * ## なぜ要るか
 *
 * **規則は起動時に解決した IP に対して置かれる**（`init-firewall.sh`）。宛先の側が
 * IP を入れ替えると、**許可一覧に書いてあるのに出られなくなる。**
 *
 * 静かに起きる。一覧を読んだ人は出られると受け取り、出られない理由を宛先の不調か
 * 自分の誤りだと考える。実際にそうなった——CI のログ本文が取れず、**許可一覧の
 * 項目が用を成していないと結論した**（AUT-161）。項目は正しく、IP が入れ替わって
 * いただけだった。
 *
 * 起動時の確認は `api.github.com` の1件しか見ていない。**1件が通れば「出られる」と
 * 出るので、他の宛先が落ちても気づけない。**
 *
 * ## 規則の中身ではなく、到達を測る
 *
 * `iptables` を読んで突き合わせる形も取れるが、採らない。**知りたいのは規則に何が
 * 書いてあるかではなく、出られるかである。** 規則を読むには特権も要る。
 *
 * 「開いているかは、必ず測って言う」と同じ考え方である。
 */

import { createConnection } from "node:net";

/** 許可一覧の書式から宛先を読む。空行と `#` は無視する。 */
export function hostsIn(text) {
  const found = [];
  for (const line of (text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const host = trimmed.split(/\s+/)[0];
    if (host !== undefined && host !== "" && !found.includes(host)) found.push(host);
  }
  return found;
}

/**
 * 1件つなげてみる。**中身は取りに行かない。**
 *
 * 出られるかどうかだけが知りたいので、TCP がつながった時点で切る。HTTP まで話すと
 * 宛先ごとの作法に付き合うことになり、**相手の不調と出口の遮断を混ぜてしまう。**
 */
export function probe(host, { port = 443, timeoutMs = 4000 } = {}) {
  return new Promise((done) => {
    const socket = createConnection({ host, port });
    const finish = (reachable, reason) => {
      socket.destroy();
      done({ host, reachable, reason });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, null));
    socket.once("timeout", () => finish(false, "つながらない（時間切れ）"));
    // **名前が引けない場合と、塞がれている場合を分ける。** 直し方が違う。
    // **Node のエラーは `code` を持つ。** `Error` だけでは引けない（AUT-226）。
    socket.once("error", (/** @type {NodeJS.ErrnoException} */ e) =>
      finish(false, e.code === "ENOTFOUND" || e.code === "EAI_AGAIN" ? "名前が引けない" : "つながらない"),
    );
  });
}

/**
 * 全部を測る。**並べて走らせる。** 直列にすると、宛先の数だけ時間切れを待つ。
 */
export async function checkAll(hosts, probeImpl = probe) {
  return Promise.all(hosts.map((h) => probeImpl(h)));
}

/**
 * 読める形にする。
 *
 * **出られたものは並べない。** 並べると、出られなかったものが埋もれる。
 */
export function report(results) {
  const blocked = results.filter((r) => !r.reachable);
  if (blocked.length === 0) {
    return { lines: [`許可した宛先 ${results.length} 件すべてへ出られる`], code: 0 };
  }

  return {
    lines: [
      `**許可した宛先のうち ${blocked.length} 件へ出られない**（全 ${results.length} 件）`,
      ...blocked.map((r) => `  ${r.host}: ${r.reason}`),
      "",
      "**多くは、宛先の IP が入れ替わったことによる。** 規則は起動時に解決した IP に",
      "対して置かれるため、入れ替わると許可一覧に書いてあっても出られない。",
      "",
      "置き直すと、多くは直る:",
      "  sudo bash .devcontainer/init-firewall.sh",
      "",
      "**置き直しても出られない宛先がある。** 規則を置いてから使うまでの間に、また",
      "入れ替わるものがある（実測で約2分。`developers.google.com`、AUT-161）。",
      "**IP を固定する形では追いつかないので、その宛先は諦める。**",
      "名前が引けない場合は別で、一覧の綴りか、宛先の側が落ちている。",
    ],
    code: 1,
  };
}
