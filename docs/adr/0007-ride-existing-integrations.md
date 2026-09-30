# ADR 0007: Ride the automation the port implementations already have. Build only what does not ride on it

- Status: Accepted
- Date: 2026-09-09
- Work item: AUT-165

## Background

The harness had its own mechanism for moving work items to done: `reconcile`. It looked for work items with integrated submissions and advanced them to done if started.

It was built in AUT-114. The problem at the time was written like this.

> Of 34 started, **30 had integrated submissions.** Only 4 were unintegrated.
> `begin` advances to started when starting, **but there is no exit.**

The mechanism built worked correctly. **Still, the same thing recurred.** Four items — AUT-163 / AUT-148 / AUT-145 / AUT-142 — stayed In Progress for days while integrated.

The cause was not a defect in the mechanism. **It was the firing condition.** `reconcile` ran only as a side effect of `begin`, and looked at only the one repository being started in. It did not mesh with a way of working that moves across four repositories.

### What was overlooked

**The Tracker implementation (Linear) had this feature from the start.** Enabling the GitHub integration moves a work item to done the moment its PR is merged. It is linked if the branch name or PR title contains the work item ID. The setup is a few checkboxes, and no code is needed.

**AUT-114 did not consider this option.** The filing makes no mention of it, going straight from pointing out the problem to "build." **It was not a rejected option but an option not looked at.**

And a human pointed out:

> I don't want to reinvent the wheel. If there is an automatic integration beyond the port and it fits this development process, we should use it.

### The definition does not prevent this

The port vocabulary convention in definition §16 limits its target to **skills.**

> Skills use only the port vocabulary and do not write implementation names. Only adapters know implementation names.

**Whether the Tracker implementation goes to look at the Repo by itself is outside the reach of this convention.** The integration is a setting of the implementation, inside the adapter boundary.

If anything, the definition says the opposite.

> **Do not keep a separate record of approval.** Repo holds the fact of integration, and holding it twice means only one side gets updated and they disagree

## Decision

**Ride the automation the port implementations already have. The harness builds only what does not ride on it.**

The order of judgment is as follows.

1. **Check whether the port implementation already has the feature.** Do not build without checking
2. If it has it, ride on it. **`/init` asks the human to do the setup** (files can be distributed, but screen settings cannot be clicked)
3. Build only if it does not have it, or it does not fit the development process. **In that case, record why it does not ride on it**

### What disappears as a result of riding on it

- `reconcile` is deleted. Automatic execution from `begin` is removed too
- The path to close by hand is held by `tracker <ID> --to done`, which remains

### What becomes needed as a result of riding on it

**If riding on an external mechanism, it must be possible to notice when it is not working.** What you ride on stops silently when it stops.

So two observations are added to `invariants`.

| Observation | Why it is needed |
|---|---|
| Work items still started though integrated | To notice the integration is not set up, or has come off |
| A work item marker still pointing at a completed work item | **The integration does not reach it.** The marker is a local file and remains even when the Tracker moves the state |

**Neither is made a failure. They stay observations.** The invariants are those of definition §9, and the Tracker-side settings are outside that scope. Failing "Telemetry is recorded" because the integration was not configured does not fit what the judgment means.

This is the same shape as the policy BOOTSTRAP decided: "that the AI cannot disable them is substituted by detection." **Not preventing, but making visible.**

## How far this decision reaches

It is not only about Tracker completion. **Other ports are judged in the same order.**

| Port | Examples of what implementations already have |
|---|---|
| Repo | Submission templates, required checks, auto-merge |
| Runner | Scheduled runs, failure notifications, reruns |
| Preview | Per-submission environments, disposal on expiry |
| Flag | Staged exposure, automatic rollback |

**Before building, look at the implementation side.**

## Remaining risks

**When the implementation is swapped, the integration settings do not come along.** The same settings must be redone on the new Tracker. This cannot be distributed as code, so it is covered by `/init`'s setup steps and the observations above.

**The settings are outside the harness, so no history of changes remains.** Who removed the integration when cannot be read from this reference implementation. When the observation appears, it is traced from there.

**These are the price of riding on it, not reasons not to.** Building it ourselves would keep a history, but in exchange we would have to maintain the firing conditions ourselves, and that failed twice, in AUT-114 and AUT-165.
