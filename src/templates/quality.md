# Quality management

**This is the record of what this project decided to check, by which method, and how far.**

The list of aspects and stages, the baseline, and how to decide are in `docs/autodrive.md` "Quality management."
**This is where the decided results go.**

**Write it in two parts.** What was built and the environment and process that build it differ in what is checked
and how. Mixed together, it becomes unreadable which is looked at and how far.

---

# Product quality

**The quality of what was built itself.**

## What the AI checks

**Write the method and how far it looks.** "It is looked at" alone does not say what is looked at or how
far.

| Aspect | Stage | Method | How far it looks |
|---|---|---|---|
| Achieving the business purpose | Acceptance | (example: E2E) | (example: only the one path from ordering to payment. Returns are not included) |
| Functionality | Unit, integration | | |
| Performance | | | |
| Security | Static | | |
| Reliability | Production monitoring | | |
| Maintainability | Static | | |

**Do not omit "how far."** The name of a method alone does not say whether it looks at everything or at a single path.
**Readers take it that ranges not written are being looked at too.**

**This table is all run automatically.** "Acceptance" is the name of a stage at which things are checked, not
something a human looks at.

### If there is "no" method, write where it goes next

**Writing "none" alone makes nothing happen next.** At the moment of writing, the hole is visible, but
it stays that way for years. It actually did (the definition repository's record had found, before anyone else, a drift in references
that nobody was looking at).

On a row that says "none," **add when it will be revisited, or a work item ID.**

## What the human checks

**Quality the AI cannot judge is ensured by the human** (definition §17). If it is not in the table,
what is looked at automatically is read as being everything.

| What | Why the AI cannot judge it | How it is looked at |
|---|---|---|
| (example: usability of the screens) | The correct answer exists only in human sense | Spot checks (definition §8) |
| (example: how much to tolerate during an outage) | Not a correct answer but a business choice | Decision at a stopping point (definition §10). Write it under levels decided |

**Lack of knowledge is not a reason to put something here** (definition §17). Regulations and
internal rules can be judged by the AI once handed over. Hand them over.

## What was decided not to check

**Write here what was deliberately left unwatched.** If not written, it cannot later be told whether it was decided
or forgotten.

| What | Why it was left open | Condition for revisiting |
|---|---|---|
| (example: performance) | (example: 10 internal users. Slowness does not stop the work) | (example: when it is opened to outside users) |

## What cannot be undone

**Things that cannot be undone if they break. Do not move on while there is no detection here.**

| What could happen | What detects it | Who triggers |
|---|---|---|
| (example: deleting production data) | (example: a test that puts a confirmation before the deletion) | Human |

**If there is none, write "none."** A blank is read as "no problem."

## Levels decided

**It was the AI that proposed and the human that chose.** It must be readable who decided.

| Item | Level decided | When decided |
|---|---|---|
| (example: availability) | (example: weekday daytime only. May be down at night) | (example: 2026-09-20) |

---

# Quality of the development environment and development process

The quality of the development environment and development process is checked on the following points. **If this breaks down, product
quality cannot be kept either.** It shows up as errors slipping through, or as records not remaining so that there is no way to choose where to fix.

## Sandbox

Write what the choice for `sandbox` in `autodrive.json` takes on.
This tool knows the contents only of devcontainer; for anything else it only
keeps the name. It is whoever chose it that knows how far it protects.

| Item | Entry |
|---|---|
| What is used | (example: Claude Managed Agent) |
| Who provides the isolation | (example: the provider. We cannot change the configuration) |
| Egress restriction | (example: follows the provider's default. There is no way to read the allowlist locally) |
| Relation to local credentials | (example: not kept locally. Passed to the environment) |
| Whether the recording hook runs | (example: confirmed / not confirmed) |

Only the last row differs in nature. **Records remaining is an invariant** (definition §9).
It is the first thing to confirm when the environment changes.

## What is checked about the development machinery

Whether the machinery for checks, records, and replacement is working.

| What | Method | How far it looks |
|---|---|---|
| (example: isolation settings) | (example: self-check at start, and the checks on the settings) | (example: whether the call to the egress restriction remains. Reachability is looked at by the check at start) |

Here too, if there is "none," write so, and write where it goes next (same as product quality). **Holes here
show up as errors in the product slipping through.**
