/**
 * サンドボックスの出口を確かめる入口。
 *
 * **人が打つものではない。** 許可してあるはずの宛先へ出られないときに、こちらが打つ。
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkAll, hostsIn, report } from "./reachability.js";
import { defaultRoot } from "./workItem.js";

const USAGE = `Check the sandbox egress

  sandbox check-destinations [--root <path>]

  The Japanese name of earlier versions (宛先を確かめる) is still accepted.

Measures whether the destinations on the allowlist are actually reachable right now. **Rules are placed against
the IPs resolved at start, so when a destination swaps its IPs it becomes unreachable.**`;

const ALLOWED = join(".devcontainer", "allowed-domains.txt");

export async function run(argv, root, probeImpl) {
  const [operation] = argv;
  if (operation === undefined || operation === "--help") return { output: USAGE, code: 0 };
  // **前の版の日本語の名前も受ける**（AUT-267）。使われたら、新しい名前を出す。
  const renamed = operation === "宛先を確かめる";
  if (operation !== "check-destinations" && !renamed) {
    return { output: `Unknown operation: ${operation}\n\n${USAGE}`, code: 1 };
  }
  const notice = renamed ? `\n("${operation}" has been renamed to "check-destinations". Use that from now on)` : "";

  const at = argv.indexOf("--root");
  const base = at === -1 ? root : resolve(argv[at + 1] ?? root);
  const path = join(base, ALLOWED);
  if (!existsSync(path)) {
    return {
      // **無いことを、出られないことと混ぜない。** 直す先が違う。
      output: `There is no allowlist (${path}). Either the configuration does not use a sandbox, or the starting point is wrong`,
      code: 1,
    };
  }

  const hosts = hostsIn(readFileSync(path, "utf8"));
  if (hosts.length === 0) return { output: `The allowlist has no destinations (${path})`, code: 1 };

  const { lines, code } = report(await checkAll(hosts, probeImpl));
  return { output: `${lines.join("\n")}${notice}`, code };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = await run(process.argv.slice(2), defaultRoot());
  console.log(output);
  process.exit(code);
}
