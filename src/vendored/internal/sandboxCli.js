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

  sandbox 宛先を確かめる [--root <path>]   Check destinations

Measures whether the destinations on the allowlist are actually reachable right now. **Rules are placed against
the IPs resolved at start, so when a destination swaps its IPs it becomes unreachable.**`;

const ALLOWED = join(".devcontainer", "allowed-domains.txt");

export async function run(argv, root, probeImpl) {
  const [operation] = argv;
  if (operation === undefined || operation === "--help") return { output: USAGE, code: 0 };
  if (operation !== "宛先を確かめる") {
    return { output: `Unknown operation: ${operation}\n\n${USAGE}`, code: 1 };
  }

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
  return { output: lines.join("\n"), code };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1]);
if (invokedDirectly) {
  const { output, code } = await run(process.argv.slice(2), defaultRoot());
  console.log(output);
  process.exit(code);
}
