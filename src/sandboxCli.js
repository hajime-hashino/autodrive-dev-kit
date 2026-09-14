/**
 * サンドボックスの出口を確かめる入口。
 *
 * **人が打つものではない。** 許可してあるはずの宛先へ出られないときに、こちらが打つ。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkAll, hostsIn, report } from "./reachability.js";
import { defaultRoot } from "./workItem.js";

const USAGE = `サンドボックスの出口を確かめる

  sandbox 宛先を確かめる [--root <場所>]

許可一覧にある宛先へ、いま本当に出られるかを測る。**規則は起動時に解決した
IP に対して置かれるため、宛先の IP が入れ替わると出られなくなる。**`;

const ALLOWED = join(".devcontainer", "allowed-domains.txt");

export async function run(argv, root, probeImpl) {
  const [operation] = argv;
  if (operation === undefined || operation === "--help") return { output: USAGE, code: 0 };
  if (operation !== "宛先を確かめる") {
    return { output: `知らない操作: ${operation}\n\n${USAGE}`, code: 1 };
  }

  const at = argv.indexOf("--root");
  const base = at === -1 ? root : resolve(argv[at + 1] ?? root);
  const path = join(base, ALLOWED);
  if (!existsSync(path)) {
    return {
      // **無いことを、出られないことと混ぜない。** 直す先が違う。
      output: `許可一覧が無い（${path}）。サンドボックスを使わない構成か、起点が違う`,
      code: 1,
    };
  }

  const hosts = hostsIn(readFileSync(path, "utf8"));
  if (hosts.length === 0) return { output: `許可一覧に宛先が1件も無い（${path}）`, code: 1 };

  const { lines, code } = report(await checkAll(hosts, probeImpl));
  return { output: lines.join("\n"), code };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = await run(process.argv.slice(2), defaultRoot());
  console.log(output);
  process.exit(code);
}
