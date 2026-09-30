# Criteria for active

Sets out, for each of the four invariants (definition §9), what `invariants` observes and what it takes as active.

Output whose grounds cannot be read means nothing, so `invariants` always prints what it observed, not only the state.

## Common principles

**Declarations are not grounds.** The material for judging is limited to the contents of repositories, git history, and Repo API responses. The existence of a file saying "we are doing it" is not a ground. A structure where active can be claimed by declaration cannot prevent the accident of operating on without it ever being connected.

**Substitution is not failure.** Definition §9 allows invariants to be substituted by human hand, only in the bootstrap phase. What is a failure is these two.

- Having no record of the substitution (the condition for the bootstrap-phase exception is not met)
- Not being able to judge ("a state in which it cannot be judged whether something is active is itself treated as a failure")

**A state with items left unjudged is not called active.** An invariant with even one unimplemented judgment does not reach `ACTIVE`, even if everything else is satisfied.

## States

| State | Meaning | Effect on the exit code |
|---|---|---|
| `ACTIVE` | Active | None |
| `SUBSTITUTED` | Substituted. A human is covering for it, and that fact is in the records | None |
| `UNSUBSTITUTED` | Unresolved. There is no record of anyone covering it, or it cannot be judged | **Non-zero** |
| `NOT_IN_SCOPE` | Not judged within this run's scope | None |

## Where substitution records are read from

The fact of a substitution is read from telemetry `type: substitution` events. The `invariant` attribute points at the target invariant.

To write one, use `invariants --substitute <invariant> --by <who> --detail <details>`. **This is not port vocabulary.** It is a statement about the active state of an invariant, something the side that judges reads, not vocabulary that skills use. It is positioned the same as `--enact`.

It is refused for an invariant that is already active. Adding a substitution record where none is needed would leave an old record behind when active falls, misleading the judgment.

No separate file for declarations is kept. Keeping one would create two truths, records and declarations, opening a path to claim active by updating only the declaration. If the fact of substitution itself is in the records, that path is closed.

## Run scope

| Scope | Target | Used for |
|---|---|---|
| `cross` (default) | The starting point and every repository directly under it | The kit's scheduled run. Judges every invariant |
| `self` | Only the starting repository | Each repository's CI. Limited to judgments complete within that repository |

Invariants hold across repositories, so judging per repository misses things. Concluding "the outer loop is not running" from one repository alone is not a judgment, since it may be running in another. So `self` judges only what can be judged, and states the rest explicitly as `NOT_IN_SCOPE`. **Pretending to judge what cannot be judged is more dangerous than stating explicitly that it is not judged.**

| Invariant | `cross` | `self` |
|---|---|---|
| The outer loop starts and keeps running | Judged | Not judged |
| Telemetry is recorded | Judged | Only structural validity (whether it is active is not judged) |
| Delegation changes stay in the history | Judged | Judged |
| The AI cannot disable any of these | Judged | Not judged |

## Judgments that are not invariants

**The judgments that fail are not only the four invariants.** Definition §9 fixes the invariants at four, and adding a fifth would be a change to the definition. So the following three are placed outside the invariants and affect only the exit code.

| What it looks at | Where | If found | Why it fails |
|---|---|---|---|
| Whether things that must not be tracked are tracked | `tracked.js` | Failure | The means of detection for "Do not keep production credentials locally" in the distributed "What to keep to." The convention existed, but nothing looked (AUT-137) |
| Whether the isolation settings are kept | `isolation.js` | Failure | Since `devcontainer.json` was made the project's own, no path is left for it to be integrated while broken (AUT-157). **Only when `sandbox` is set to devcontainer** (ADR 0012) |
| Whether the definition sections cited are still the sections meant | `definitionSections.js` | Failure | When the definition added a new §17, 11 places were left pointing at the old number. Nobody noticed (AUT-232). **Judged only in cross** (only where the definition repository sits alongside can it be seen) |

**None of them stops at an observation.** If it is printed but does not fail, nobody notices in CI.

---

## 1. The outer loop starts and keeps running

Per definition §8, one round of the outer loop completes when "a cell in the delegation table moves and its ground remains in the history." So the history of delegation changes is the observation point.

**Starting**: the history of delegation changes has at least one entry that has all three of the following.

- A ground (a track record from telemetry, such as the count under observation)
- The commit hash of the configuration change. That commit actually changes `boundaries.yaml`
- That commit is included in a submission that went through human approval

**Continuing**: the date of the latest entry is within a threshold. **No threshold is set.** Definition §18 leaves the loosening threshold undecided, and deciding it without real data would leave a number with no ground. `N/A` is printed until starting is satisfied.

### What counts as "a cell moved"

For a commit that changed `boundaries.yaml`, **compare with the contents at the parent commit.** If an area was added or removed, or any of `detectable` / `reversible` / `state` changed, it counts as a move.

- **The initial placement is not a move.** A commit whose parent does not have the file (the commit that created the file) is this. Just placing the table does not complete a round of the outer loop
- **Adding comments or grounds is not a move.** Even if the table looks different, what is entrusted has not changed

### How approval is derived

**Whether "Integrate change" was executed for that commit** is asked of the Repo API. If integrated, it is taken as approved.

Definition §8 says "approval is derived from the fact of 'Integrate change'" (settled in v0.9). The AI can rewrite the delegation table and write "approved," but it cannot make it integrated.

**No separate record of approval is kept.** Repo holds the fact of integration. A form such as an approver field in the history of delegation changes would let the writer claim approval.

### If it cannot be read, it fails

**Treated as a failure, not a substitution.** A state where a cell moved but approval cannot be confirmed is not substituted but not judged, and definition §9 makes that itself a failure. Passing it with a substitution would hide the inability to judge inside the substitution.

However, **if even one entry has approval, "has it started" has been judged.** Another entry that could not be read does not overturn the conclusion, but it is a hole, so it is kept as an observation.

A read-only token cannot read integration. The token used for the checks needs read access to submissions (see `.env.example`).

## 2. Telemetry is recorded

"Records exist" is not enough. A state where things remain only if people or the AI remember does not meet definition §9's "built in as the default behavior of the harness."

**The harness and the runtime are different things.** This document uses them as follows.

| Term | What it refers to |
|---|---|
| Harness | The machinery that finds errors mechanically (tests, checks, CI). The term of definition §5 and §7 |
| Runtime | The ground the AI runs on (Claude Code). Where hooks are registered |

Records remaining automatically is **achieved by registering a hook with the runtime.** That is what the definition calls
"built in as the default behavior of the harness." So the condition for active is **that records are written through the adapter.**

To judge this mechanically, every event has an `emitter` attribute.

| Value | Meaning |
|---|---|
| `adapter` | Written through the port vocabulary of definition §16 |
| `manual` | No adapter existed; written directly to the file |

### Judged from the activation boundary onward

Direct writes from the bootstrap phase remain in the records, so judging the whole period would never reach active. So the judgment covers events from the last recorded **activation boundary** onward.

The activation boundary is not a one-time switch point but a record that can move. Even after a failure makes the adapter unusable and things fall back to direct writes, it can recover once fixed. **Advancing the activation boundary needs a working adapter** (since the boundary record itself is written through the adapter). Advance it with `invariants --enact telemetry_recorded`; it is refused if the hook is not registered.

| What is looked at | Target |
|---|---|
| Validity of required attributes | **The whole period.** They cannot be attached retroactively, so being before the activation boundary is no reason for them to be missing |
| Whether the write path is automatic | From the activation boundary onward. The question is "how is it now" |
| Substitution records | The whole period. Substitutions written before the activation boundary also count |

**Records before the activation boundary are not deleted.** They are only excluded from judging, and remain as history.

The number of times the activation boundary was advanced is printed. Moving many times is a signal that the harness is not stable, and an input the outer loop should read. **How many times counts as abnormal is not set** (definition §18).

Details are in [ADR 0003](adr/0003-enactment-boundary.md).

The judgment proceeds in this order.

In `self`, it looks only at whether records are broken (readable, required attributes valid), and whether it is active is `NOT_IN_SCOPE`. One repository's records alone cannot decide whether the harness takes charge of recording. Stating explicitly that it is not judged is more correct than forcing a substitution record to claim substitution. Broken records are treated as failures in `self` too, so nothing is overlooked.

1. There is not a single event → `UNSUBSTITUTED`
2. There are unreadable lines → `UNSUBSTITUTED`
3. There are events missing `work_item_id` / `model` / `kit_version` / `emitter`, or **events with empty values** → `UNSUBSTITUTED`. These cannot be attached retroactively, so substitution cannot fill them

   It looks at values, not only whether the attribute exists. Checking existence alone would let through records where `null` was written.

   However, **records that could not be attributed are excluded** (below).
4. `emitter` has an undefined value → `UNSUBSTITUTED`
5. There is even one `emitter: manual` → `SUBSTITUTED`
6. Everything is satisfied → `ACTIVE`

### Records that could not be attributed

Records in `telemetry/unattributed.jsonl` that have `unattributed_reason` **are not required to have `work_item_id`.**

Definition §6 (v0.10) **sorts out exchanges not attributable to a work item as not being §6 events.** Deliberating whether to raise a work item, or requests not yet filed, are such exchanges. The required attributes are not imposed on them. **It is not an exception; they are out of scope.**

When the adapter cannot resolve the work item, it does not throw the record away but writes it to this file with a reason. **It is not a broken record, but the place for costs that could not be attributed.**

The definition imposes two conditions, and the implementation meets them like this.

| Condition in §6 (v0.10) | Implementation |
|---|---|
| Do not discard the records | The adapter writes to `unattributed.jsonl` with a reason. The checks do not make this a failure |
| Keep the count readable | `invariants` always prints the count and the reasons as observations |

There are two conditions so as not to create a loophole.

| Condition | What happens without it |
|---|---|
| **The place is** `unattributed.jsonl` | Looking only at the reason, any record could avoid having a work item by declaring "could not attribute" |
| **It has a reason** (`unattributed_reason`) | Looking only at the place, anything could be thrown into that file |

**Only `work_item_id` is exempted.** `model` / `kit_version` / `emitter` come from the runtime and are always attached even if unattributable. If missing, it fails.

**The count and reasons are always printed.** It does not prevent active, but it does not hide them either.

```
observed  1 records could not be attributed to a work item
observed  Why it could not be attributed: 作業単位マーカーが無い。作業単位に紐づかないやり取り（起票するかの検討など）である可能性がある
```

The reason is a value written into the record, so it stays as it was written (in Japanese, for records written so far).

### Telling reasons apart

**Whatever can be attributed must be linked** (§6). Treating something as unattributed is allowed only when there is no way to link it in the mechanism. So the adapter distinguishes three reasons for not resolving it.

| State | Meaning |
|---|---|
| No marker | Possibly an exchange not linked to a work item. **Includes normal cases** |
| The marker cannot be read | Broken. **Records that should have been linked remain unattributed** |
| The marker's contents are missing | Same as above. It also writes which attribute is missing |

**Do not report them in the same words.** There are three records of misleading people by stating differently caused things in the same words (two in AUT-37, AUT-39). From counts alone, it cannot be told whether there is nothing to link to or the adapter is broken.

Note that §6 makes **not setting up** a mechanism to force filing the default. The unattributed amount is small, and the effort to make it strict does more for §4 when directed elsewhere. **Since the count is readable, the judgment can be redone as soon as the amount can no longer be ignored.**

In addition, `cross` looks at whether the hook that records automatically is registered with the runtime. Without registration, there is no guarantee it will continue even if it is writing automatically now, so it is not allowed to reach `ACTIVE`.

**The registration is inside the repository (`.claude/settings.json`).** Placed outside the repository, `invariants` could not read it and would not notice if it were removed. Being in a readable place is the premise of the policy of substituting by detection rather than enforcement.

Note that the state "registered but not yet trusted, so not running" cannot be read from the repository. But in that case no `emitter: adapter` events appear, so it does not rise to active as a result. Whether it is registered and whether it actually runs are covered by separate observations.

Records that require judgment (missed detections, the breakdown of rework causes, spot check results) are also `adapter` once the adapter exists, since they are written through the port vocabulary of definition §16. A human deciding the contents and the write path being the adapter are separate things. So `manual` appears only in the bootstrap phase.

**If records whose `manual` does not go away appear from stage 1 onward, that is a signal that the port vocabulary lacks an operation.** Send it back to the definition.

### Matching records against work items (`cross` only)

The condition was originally "every completed work item has records," but as is, that produces false positives. It would demand records even from work items completed without any work (such as a filing that sends something back to the definition).

What can be judged reliably is the reverse direction: **whether the work items records point at exist can be seen without false positives.**

| Observation | Judgment |
|---|---|
| No Tracker credentials, or it cannot be read | `UNSUBSTITUTED`. A state that cannot be judged does not pass |
| There are records pointing at a work item that does not exist | `UNSUBSTITUTED`. A typo, or records for a work item that was never created |
| There are completed work items with no records | Printed as an observation. **Not made a failure** |

The last is not made a failure because this information alone cannot tell whether there was no work or the records went to another work item. Treating what cannot be told apart as a failure dilutes what failure means.

### Also looking at the state of work items themselves (`cross` only)

**The harness no longer has a mechanism to complete work items.** The Tracker–Repo integration moves them (ADR 0007). **So a place is needed to notice when it is not working.** What you ride on stops silently when it stops.

| Observation | Judgment |
|---|---|
| There is an integrated submission, but the work item is still started | Printed as an observation. **Not made a failure** |
| The work item marker points at a completed work item | Printed as an observation. **Not made a failure** |
| No Repo credentials, so submissions cannot be read | Printed as an observation that it could not read them |

**Both are looked at here because they directly affect which work item records get linked to.** A work item left unclosed keeps receiving records. A marker that is not removed puts records written until the next start into a completed work item.

**They are not made failures because the invariants are those of definition §9, and the Tracker-side settings are outside that scope.** Failing "Telemetry is recorded" because the integration was not configured does not fit what the judgment means. Being visible is enough.

The marker side is **the part the integration does not reach.** It is a local file and remains even when the Tracker moves the state. It is overwritten on every start, so it happens only until the next start.

## 3. Delegation changes stay in the history

The observation target is the same as invariant 1, but the question is different. 1 asks "is the loop running," 3 asks "when it moves, does it remain without omission."

It takes every commit that changed `boundaries.yaml` from `git log`, and looks at whether each commit is referenced from the history of delegation changes. If even one commit is unreferenced, a change is missing from the history.

**When `boundaries.yaml` does not exist, it is not made `ACTIVE`.** With nothing to move, the empty set formally satisfies it, but that only means there is no mechanism. It is treated as `SUBSTITUTED`.

This can be judged per submission, so it can be used in each repository's CI as `--scope self`.

## 4. The AI cannot disable any of these

Substituted by detection rather than enforcement (BOOTSTRAP, "decided before starting"). So the condition for active is not "the AI actually cannot disable them" but **that disabling them is always noticed.**

It reads the protection settings of each repository's default branch from the Repo API.

| Observation | Judgment |
|---|---|
| No API token | `UNSUBSTITUTED`. A state that cannot be judged does not pass |
| Some targets' responses cannot be read | `UNSUBSTITUTED`. Same as above |
| `403 Upgrade to GitHub Pro...` | A plan limitation. Protection settings cannot be held → `SUBSTITUTED` |
| 0 rulesets | Not protected → `SUBSTITUTED` |
| There are rulesets | On to the next verification |

**The 403 response code itself is used as the observation.** It is derived from the platform's response rather than a declaration, so the judgment holds mechanically.

### Changes that entered the default branch without a submission

**Even without protection settings, whether it was broken can be seen.** Having chosen substitution by detection rather than enforcement in stage 0, the state of guaranteeing it by convention alone without detection is not continued.

It follows the default branch's first-parent, and **takes non-merge commits as candidates.** Changes that went through a submission enter the default branch as merge commits.

| Observation | Judgment |
|---|---|
| No candidates | Prints "entered through a submission" as an observation |
| Candidates, included in an integrated submission | Not counted as direct commits (the squash merge case) |
| Candidates, not included in a submission | `UNSUBSTITUTED`. **The convention has been broken, and the substitution does not hold** |
| The default branch or history cannot be read | `UNSUBSTITUTED`. A state that cannot be judged does not pass |

- **Commits with no parent are excluded.** That is the point the repository was created, when the submission mechanism did not exist yet. The same as not counting the initial placement of the delegation table as a move
- **For the default branch, the local setting (`origin/HEAD`) is looked at first, and the Repo is asked if it is missing.** A working tree created with `git init` has no local setting. Stopping there would raise a false alarm for a repository with no problem
- The Repo API is asked only when candidates appear. **Normally no API calls are made**

This does not make invariant 4 active (rulesets still cannot be held). **It raises the quality of the substitution.**

Verifying that `invariants` is registered as a required check is not implemented. Confirming the registration itself depends on rulesets, and under the plan limitation there is no means of judging.

Verifying that the credentials given to the agent cannot change protection settings is not implemented either.
