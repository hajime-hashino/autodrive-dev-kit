# ADR 0012: The sandbox is something the project declares

- Status: Accepted
- Date: 2026-09-23
- Work item: AUT-218

## Background

Subject app 1 (agent-playground) runs in a form that spins up a disposable container per work item (Orca). The only choices for `sandbox` are `devcontainer` and `none`, so its configuration says `sandbox: none`. **It uses one, but it says "not used."**

Adding one choice would be a small matter, but **a human raised "should the reference implementation side be looking at this egress restriction?"** There are many sandbox implementations outside (Claude Managed Agent, Kubernetes Agent Sandbox, Codex Sandbox, and so on), and having the reference implementation look after all of them would be too heavy. The core of the reference implementation is making AI-driven development run, not building egress restrictions.

### The reference implementation was doing something different from what it said

`autodrive-reference.md` says what protects is not the egress restriction.

> What actually protects is something else.
> - Not keeping credentials locally
> - Stopping at fixed conditions
> - Records remaining
> … Do not weaken these and try to make up for it with the egress restriction. **It cannot make up for them.**

Meanwhile, the result of `isolationGaps` went into `exitCode`, and **it failed if isolation settings were missing.** What was written as "cannot make up for" was treated as a failure by the checks.

Furthermore, **isolation is not an invariant of definition §9.** The invariants are fixed at four: `outer_loop_running` / `telemetry_recorded` / `boundary_change_logged` / `ai_cannot_disable`.

### What failed did not match reality

| State | The judgment until then |
|---|---|
| Using Orca (no devcontainer.json) | **Passes.** Nothing to look at |
| Declared devcontainer, and deleted the whole definition | **Passes.** Same as above |
| Using devcontainer, with settings missing | Fails |

**The second row is a hole.** Even though the declaration and the real thing disagreed, nothing said so.

Also, `placeSandbox` placed the whole `.devcontainer/` set for everything other than `none`. **A devcontainer lands on projects that chose Orca.** What lands also becomes subject to the checks, so it fails on missing settings of something not in use.

## Decision

**The Sandbox port becomes something the project declares, not something the reference implementation prepares.**

| | Reference implementation | Project |
|---|---|---|
| `devcontainer` | Places the whole set and checks the settings | Maintains what was placed |
| Anything else (`orca`, `other`, any name) | **Only keeps the name. Nothing is placed and nothing is checked** | **Prepares it. Writes what is protected** |
| `none` | Does nothing | A record of deciding not to isolate remains |

### Three consequences

**1. The list of choices stops trying to be exhaustive.**

`orca` and `other` were added to `PORT_CHOICES.sandbox`, but **this is not exhaustive.** Configuration values are not matched against it, and unknown names pass. A form that fixes the reference implementation every time one is added cannot keep up, and **a list that cannot keep up makes what is not on it look like "must not be used."**

**2. `.devcontainer/` is placed only when `devcontainer` is chosen.**

What is distributed does not change. **The condition under which it lands is matched to what was chosen.**

**3. The ground for the judgment moves from the placed files to the declaration.**

If `sandbox: "devcontainer"` is written, it is looked at. If another name, it is not. If declared but there is no definition, **that itself is reported as a hole** (closing the second row of the table above).

Only when the configuration cannot be read is it decided by the placed files. **There are workspaces where `init` was never run** (those pointing directly at the reference implementation). If the judgment disappeared there, a detection currently in effect would silently vanish.

### The devcontainer judgment is not weakened

This judgment is what catches what actually happened in AUT-121.

```
sandbox created   2026-08-23
container started 2026-09-02        ← 10 days later. it had restarted
iptables -S       -P OUTPUT ACCEPT  ← the default is allow. 0 rules
example.com       HTTP 200          ← not on the allowlist. straight through
```

**In projects that chose devcontainer, it remains a failure.** What changed is the scope of application, not the strength.

## Options not chosen

| Option | Why not chosen |
|---|---|
| Add a check per sandbox | **Cannot keep up.** Implementations keep multiplying outside, and their contents are outside the reference implementation's control. Some, like Claude Managed Agent, have no means even to read their configuration |
| Drop all isolation checks | Loses the AUT-121 pattern. **It would give up, for no reason, what is currently being caught** |
| Make isolation a fifth invariant | **It would change the definition** (§9 is fixed at four). AUT-121 made the same judgment |
| Share the egress restriction mechanism between devcontainer and Orca | `init-firewall.sh` itself is a plain iptables script with no devcontainer dependency, so it could be shared. **But Orca's containers start without `--cap-add`, so rules cannot be placed as is.** And pursuing this returns to the form of looking after each sandbox |

## Impact

**This is a change in the direction of loosening the checks.** There is a path where what used to fail no longer fails (projects that declared something other than devcontainer). **What was loosened is written out into "Development environment (sandbox)" in `docs/quality.md`.** A state where the check disappears and no record remains is not created.

**The recording hook is heavier.** `recordTokens` rides on the `transcript_path` and `session_id` passed by the Stop hook, and on records placed in the local file system. When changing environments, this is what should be checked before the egress restriction. `telemetry_recorded` is an invariant; isolation is not.
