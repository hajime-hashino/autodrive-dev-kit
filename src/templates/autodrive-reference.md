# Reference

**This document was placed by autodrive-dev-kit.** If you want to change it, file a work item
with autodrive-dev-kit. Changes made here are overwritten the next time it is distributed.

## What this is

**This is what you look up when stuck with the standard parts autodrive-dev-kit placed.**

What you read every time is [autodrive.md](autodrive.md). **This one does not need to be read every time.**
It is opened after you run into something.
They are split because **what is read every time directly eats into the room left for the work itself.**

## It may not apply

**What is written here assumes the standard parts are in place as they are.**

**If this project has modified them, that no longer holds.** The sandbox configuration was
changed, CI was rearranged, the deployment mechanism was swapped — in such cases, what is written here is
outdated or does not apply.

**When unsure, read the real thing.** `autodrive.json`, the CI definitions, and `.devcontainer/` are authoritative,
**not this document.** If they disagree, the real thing is right. **And file a work item with
autodrive-dev-kit.**

## What is in it

**It is in two parts. They differ in nature.**

**Part 1: The grounds for the conventions.** Why they are set the way they are.

| When to look it up | Section |
|---|---|
| Unsure how to behave | Do not make decisions on the human's behalf / Check whether it is a constraint by its source / Signs to stop and reconsider |
| Unsure how starting and completion work | Why there is a single entrance / Why not mark it done by hand / Pausing and coming back / If records were left behind |

**Part 2: Using the standard parts.** When doing something outside the standard, or when stuck.

| When to look it up | Section |
|---|---|
| Want to add quality methods | Methods for checking quality |
| Moved the delegation table | When the scope of delegation moves, add a section to the history |
| Touching `.devcontainer/` | The sandbox definition may be edited directly |
| More destinations or keys | The app's own credentials go in the configuration |
| Replacing the tool | Updating autodrive-dev-kit |
| Traffic gets blocked | Egress restriction is not a mechanism that cuts off traffic / Allowed destinations can become unreachable |
| CI failed and you want to read why | CI failures can be read down to the log body |
| Making something visible from outside | Exposure can be reverted but not undone |

**What is written here is limited to what machinery cannot guarantee.** If the tool says the same thing at run time,
leave it to that and do not write it. **Moving what can be written into machinery comes first.**

---

# Part 1　The grounds for the conventions

**This explains why things are set the way they are.** It is not how to use the parts.

## How to behave

**This makes "Behavior and stance" in [autodrive.md](autodrive.md) concrete.**

### Do not make decisions on the human's behalf

Leading is different from deciding for them. **The role is to lower the cost of judgment, not to eliminate judgment.**

| Kind | What the AI does |
|---|---|
| Procedure | Executes it. Only if it cannot, shows the procedure and asks |
| Decision (What / Why, moving the scope of delegation, anything touching fixed conditions) | Shows options, material for the judgment, and a recommendation; **the human chooses** |

Do not pass through with a default value something that looks like a judgment. Conversely, do not throw at the human as a judgment something that is only procedure. **Both lower "output per unit of human involvement."**

### Check whether it is a constraint by its source

When you judge that "this must not be done," be able to say where that comes from.

| Source | Treatment |
|---|---|
| The definition | A constraint. Follow it. Changing it requires sending it back to the definition |
| **This document** | A constraint. It was distributed by autodrive-dev-kit, and changing it requires filing with autodrive-dev-kit |
| The project's `CLAUDE.md` | A constraint. Changing it requires human approval |
| **Your own reasoning** | **Not a constraint.** It is a design judgment, to be compared with other options |

Treating your own reasoning as a constraint without checking its source **leaves behind designs that work around constraints that do not exist.** Even if such a design creates new defects, it looks like the result of following the conventions, so it is hard to notice.

Conventions are not there to bind judgment but to make the results of judgment verifiable. **Having followed the conventions does not explain the design being correct.**

### Do not trade a design defect for compliance with conventions or for saving effort

When they cannot both be satisfied, show the human that fact and the options available. Do not silently choose one. The reason is the same as "Do not make decisions on the human's behalf."

When adopting a human's request, verify separately whether it is correct as a design. **Do not make "met the request" the conclusion.** If it is correct, state why; if not, show an alternative. Take into account the intent behind the instruction. It is better to confirm the intent and rebuild than to build exactly as instructed and not meet the need.

It is the human who decides, however (definition §10). The responsibility extends to showing, not to pushing through.

### Verify a means of checking when you build it

Write tests for what can be tested. For what cannot, confirm it works before submitting.

**Confirm that the test fails against a broken implementation.** Confirming only that it passes cannot be told apart from a test that looks at nothing.

**Confirm that the means can catch the problem that actually occurred.** Do not place something that makes you feel you caught what it cannot catch.

### Signs to stop and reconsider

If you notice any of the following, suspect the design. **Each comes from a failure that actually happened.**

- **You are about to deal with a one-off problem with a permanent mechanism**
- **You are explaining a design judgment with "because there is a convention that..."**
- **A mechanism for working around a constraint is creating a new hole**
- **You are referring to only part of a convention or the definition without reading it through**
- **You are guessing at a cause and writing it as a conclusion without confirming it**

### Reducing stops is different from hiding them

The number of stops is something the outer loop works to reduce, but **necessary stops must not be skipped.** In particular, operations touching the fixed conditions of definition §9 (destructive operations on production data, movement of money, irreversible external publication) always stop, no matter how much track record accumulates.

What to reduce is **stops of the same kind that recur.** When they appear, do not put up with the count; file an improvement proposal for the outer loop.

## Starting and completing

### Why there is a single entrance

`begin` does all of the following at once: checking the work item, bringing the default branch up to date and creating a branch, and placing
the link for records. **Stepping through them by hand, you cannot notice having skipped one.**

**Even if a convention exists, without going through the procedure there is no occasion to remember it.** Going through the entrance removes the need
to remember.

### Why not mark it done by hand

Completion is done by the Tracker–Repo integration. The branch `begin` creates carries the work item ID in its
name, so the Tracker side moves it the moment that submission is integrated. The target repository is noted on the work item
when work starts.

**You could run it, and that is exactly why it is a convention.** Marking it done by hand erases the ground "it is done because it was integrated."
The done state would represent the judgment of whoever ran it, not the integration of the submission.

**Closing it as a side effect of starting is not enough.** It looks at only the one repository being started in, so
items are left behind when moving across several repositories. **An integration moves at the moment of integration, in any repository.**

If the integration is not configured, **items keep piling up as started.** When that happens,
`invariants` reports them as "work items still started though integrated" (「統合済みなのに着手中の作業単位」). If that appears, first check the integration
settings.

### Token consumption is not in `telemetry/`

**That is correct.** The hook writes after the submission, so putting it in the repository would mix it into another work item's
submission. It is therefore kept off the branch and sent elsewhere (autodrive-dev-kit [ADR 0008](https://github.com/hajime-hashino/autodrive-dev-kit/blob/main/docs/adr/0008-token-usage-off-branch.md)).

What remains in `telemetry/` is only the records written with the `telemetry` command.

### Pausing and coming back

**Run `begin` with the same work item ID.** If the branch already exists, it returns to it without creating one.

It used to say "pass a different name with `--branch`." **It recommended a different name when you wanted to
resume, and following it produced two branches for one work item** (AUT-206).

**"Do not start on top of another branch" does not block resuming.** What that constraint protects is
**the creation of branches.** Stacking on an already-integrated branch means the change never arrives (AUT-38).
**Returning to a branch that already exists is not stacking.**

**Do not `git checkout` by hand.** The link for records is not re-placed, and records written after
returning go to the previous work item (AUT-221).

### If records were left behind

**It says so when starting. It does not pick them up.** It used to pick them up and commit them, but that was **putting another
work item's records into the submission of the work item just started.** Changes unrelated to the work got
mixed in and misled whoever read the submission's diff.

When told, **check which work item they belong to.** If it is the one just started, they may be submitted together with this work's
changes. If they belong to another work item, put them on that branch.

If there are leftovers in other repositories, it only says that they exist. **Do not touch them there** (because the repositories one
work item writes changes to are limited to one). They ride along the next time work starts in that repository.

---

# Part 2　Using the standard parts

**A guide for doing something outside the standard, or when stuck.** What may be touched,
how to add things, and **pitfalls machinery cannot prevent.**

## Methods for checking quality

**The baseline in `docs/autodrive.md` "Quality management" lists only cheap, effective ones.**
Choose from here when it is not enough. **Look it up to choose, not to line things up.**

| Kind | Methods |
|---|---|
| Static (read without running) | Type checking, linters, static analysis (SAST), dependency vulnerability scanning (SCA), scanning for leaked secrets, IaC scanning, license checks, measuring complexity and duplication |
| Dynamic (run to confirm) | Unit tests, integration tests, contract testing, E2E, performance / load / stress testing, DAST, fuzzing, automated accessibility checks, chaos testing |
| Read to confirm | Human code review, **AI review**, design review, **threat modeling**, security review, penetration testing |
| Watch while running | Production monitoring, SLOs and error budgets, synthetic monitoring, canary / staged rollout, feature flags |
| Check the checking mechanism | **Mutation testing** (see whether tests fail against a broken implementation) |

**Do not forget the last one.** The other methods produce "passed," but **passing cannot be told apart from
looking at nothing.** autodrive-dev-kit itself uses it (`npm run mutate`).

**Human review is also a method.** However, it **moves the delegation table** (definition §8). It is not something to
put in because it is cheap.

## When the scope of delegation moves, add a section to the history

A change that moved `boundaries.yaml` **must be referenced from the history** in `docs/boundary-changes.md`
(the invariant "Delegation changes stay in the history"). Without the reference, it fails.

**While the table has only been placed, it is not needed yet.** Placing and moving are different things.

```
## 2026-09-23 Implementation to under observation
- Ground: 12 under observation, no human corrections
- Work item: AUT-999
- Afterwards: 2026-10-05 one broken layout → back to under observation
```

**Do not omit the "Ground" field.** If it does not say how many consecutive times passed without correction,
it cannot later be confirmed whether loosening was right.

### What to point with

**Point with the work item ID.** A commit ID also passes, but **it depends on how things are integrated.**

| Pointing with | merge commit | squash / rebase |
|---|---|---|
| Work item ID (`AUT-999`) | Passes | **Passes** |
| Commit ID (`commit 5014785`) | Passes | **Fails** |

Squash and rebase recreate the IDs on the default branch. **The history points at the IDs on
the branch side, which no longer exist after integration.**

**It fails after integration.** It passes at submission time. **What passed fails the moment
it is integrated.** The cause is hard to trace.

**The checks do not look at how things are integrated.** GitHub's settings (whether squash is allowed) cannot be read
with the credentials used for checks, and reading them would mean widening permissions. **Widening a read-only key
dilutes the point of separating the side that checks from the side being checked.**

Therefore **it is noticed only when it fails after integration.** Written with the work item ID,
you never step on it in the first place.

## The sandbox definition may be edited directly

**This applies to projects that chose `devcontainer` for `sandbox`.** If something else was
chosen, `.devcontainer/` is not placed and the isolation checks do not run. Preparing it is up to that choice,
and what is protected is written in `docs/quality.md` (autodrive-dev-kit [ADR 0012](https://github.com/hajime-hashino/autodrive-dev-kit/blob/main/docs/adr/0012-sandbox-is-declared-not-built.md)).

`.devcontainer/devcontainer.json` **belongs to this project.** Adding features,
forwarding ports, setting environment variables — **write them directly in that file.** The configuration has no setting for
them. `update` does not rewrite this file.

**The other files in `.devcontainer/` are different.** `init-firewall.sh`, `post-create.sh`,
`check-setup.sh`, and `allowed-domains.txt` are managed by the kit, and changing them by hand makes `update`
stop. **They are the isolation logic, and the place to fix them is autodrive-dev-kit.**

| File | Whose |
|---|---|
| `devcontainer.json` | **This project.** May be edited directly |
| `devcontainer-lock.json` | This project. The CLI rewrites it on every rebuild |
| `init-firewall.sh` / `post-create.sh` / `check-setup.sh` | The kit. Do not change by hand |
| `allowed-domains.txt` | The kit. Write in `app.destinations` (below) |

##### But some lines remove the isolation if taken out

```jsonc
"runArgs": ["--cap-add=NET_ADMIN", "--cap-add=NET_RAW"],   // needed to place the rules
// re-place the rules on every start, then confirm it is closed
"postStartCommand": "sudo bash .devcontainer/init-firewall.sh && { bash .devcontainer/check-setup.sh || true; }",
"remoteUser": "vscode",                                     // do not run as root
```

**The checks look at these three.** Take them out and `invariants` fails, and CI stops.

**Do not move it to `postCreateCommand`.** That runs only when the container is created. iptables
rules live in the container's network namespace and disappear when it stops, so **from the second
start onward the isolation is gone.** From inside, nothing looks different. **What notices is the checks.**

**For the same reason, do not put the confirmation in postCreateCommand either.** postCreate runs before postStart,
so **at the time of confirmation the rules are always absent, and it reports "not in effect" every time.**
Warnings that fire by mistake make real warnings get dismissed as "probably another false alarm."

**The checks only look at whether it is written.** Whether traffic can actually get out is confirmed by `init-firewall.sh`
in both directions on every start. **Both are needed.**

##### Rebuilding changes the lock

`.devcontainer/devcontainer-lock.json` gets the versions the Dev Containers CLI resolved written into it every time the sandbox is rebuilt.
**It is not a change on our side. Do not treat it as something changed
by hand.** Even if it shows up in a diff, it is not something to fix.

##### Features that run containers inside bypass the egress restriction

**Know this before adding one.** The egress restriction only narrows the traffic this machine sends out
(`OUTPUT`). **Traffic passing through (`FORWARD`) is not narrowed.**

Traffic from containers run inside goes through `FORWARD`. **Therefore it can reach destinations
not on the allowlist.** Outside the egress restriction, one more unrestricted path appears.

When adding a feature like `docker-in-docker`, **add it knowing that.**
Read the egress restriction as "cutting off traffic," and you cannot notice it is open.

The isolated place **blocks most destinations not on the list (`.devcontainer/allowed-domains.txt`).**
The list holds only the destinations autodrive-dev-kit needs. Destinations what you are building calls, and connectivity checks
against where you deploy, are not in it.

Add them to `app.destinations` in `autodrive.json` and **run the update**
("Updating autodrive-dev-kit"). **Do not edit the allowlist directly.** That file is managed by autodrive-dev-kit.

```json
{
  "app": {
    "destinations": [
      { "host": "example.workers.dev", "why": "connectivity check of the deployment target" }
    ]
  }
}
```

**`why` cannot be omitted.** The allowlist assumes "if you cannot write why it is needed, it is not needed."
Omit it and `update` stops.

**Wildcards cannot be written.** Rules are placed against resolved IPs, so
something like `*.example.com` cannot be written. Each destination needs its own line.


## The app's own credentials go in the configuration

What autodrive-dev-kit needs (such as `GH_TOKEN`) is listed in `.env.example`. **Keys that what you are building
needs for itself are not in it.** Keys for calling a model, keys for external services, and so on.

Add them to `app.credentials` in `autodrive.json` and **run the update**
("Updating autodrive-dev-kit"). **Do not write directly into `.env.example`.** That file is managed by autodrive-dev-kit.

```json
{
  "app": {
    "credentials": [
      { "name": "ANTHROPIC_API_KEY", "why": "calls the model. without it the conversation cannot happen", "lost": "reissue it. the old value stops working" }
    ]
  }
}
```

**`why` and `lost` cannot be omitted.** With names alone, the human does not know what to go and get,
and cannot judge how serious losing it would be. Omit them and `update` stops.

**If not written, it breaks silently.** As long as the value remains in `.env`, the app keeps running, so
nobody notices it is gone. **Someone new looking at the template cannot learn that the key exists.**


## Updating autodrive-dev-kit

```sh
npx github:hajime-hashino/autodrive-dev-kit update
```

**This is not something the human runs. Make it a work item, and we do it.**

**Fetch it from outside.** It cannot be run from the copy in `{{KIT}}/`, because the templates are not
included there.

Updating is **a change that rewrites files this project tracks**
(`{{KIT}}/`, this document, the CI definitions, `.devcontainer/`, `.env.example`). Every change is
integrated through a submission. **Do not run it on the default branch and commit directly.**

1. File it and start with `begin`. The target repository is this project
2. Run `update`
3. Run the checks and tests, and submit

**Configuration changes are applied this way too.** Writing in `autodrive.json` alone does not
recreate `.devcontainer/` or `.env.example`.

**The kit version goes up at the same time.** What is fetched is the latest, and there is no way to run it that applies only
the configuration change. Check the diff from the version bump within the same work item as well.

### Replacing with a specific version

**It need not be the latest.** Append `#` and a version after the name, and that version is used.

```sh
npx github:hajime-hashino/autodrive-dev-kit#v0.1.1 update
```

**Run it this way only when the human names a version.** If none is named, fetch the latest. Which versions exist is
in autodrive-dev-kit's tags.

**What it is running on now is in `{{KIT}}/VERSION`.** Do not guess; read it.
The `kit_version` attached to records is this value as well.

### If it stops, hand it back to the human

**If managed files were changed by hand, `update` stops without deleting them.** Replacing them
as-is would erase what was put in by hand.

If it stops, do not settle it one way or the other on your own. **The fact that they were changed by hand is a reason to file with
autodrive-dev-kit.** They were changed that way because there was a need.

### If credentials were added, ask for them to be issued

Items may be added to `.env.example`. **We cannot issue them.** Ask the human, along with what each
is used for and what does not work without it.

### Changing a port

When asked "I want to keep work items in GitHub Issues" or "I want to change the sandbox,"
**rewrite `ports` in `autodrive.json` and run `update`.** There is no dedicated way to run it.

**Which one to use is the human's decision.** Rewriting and running is ours. The implementations available are the same as those `init`
asks about.

**Before changing, tell the human what is lost.** It cannot be recovered after the change.

| What changes | What to tell before changing |
|---|---|
| Tracker | **Existing work items do not move.** Records and branch names keep the old IDs. Anything started must be closed in the old place |
| Tracker to `github-issues` | Have them decide the prefix (the `AIEP` in `AIEP-123`). **Changing it later breaks the trail of earlier records** |
| Tracker to `linear` | Have them connect GitHub in Linear's settings, so that items complete when integrated |
| Sandbox | Reopening is needed. Moving away from `devcontainer` leaves the placed set behind rather than deleting it |

**To change without raising the version, run it naming the current version.** Without naming it, the latest comes, and
the port change and the kit replacement get mixed into one change.

```sh
npx github:hajime-hashino/autodrive-dev-kit#v<value of {{KIT}}/VERSION> update
```

`update` prints the following. **Pass on what concerns the human as it is.**

- The ports that changed, and their previous values
- Newly needed credentials (ask for them to be issued)
- What was placed for the previous configuration but is no longer placed (delete if not needed)

**If the prefix has not been decided, `update` stops without placing anything.** It suggests one, so confirm with the human
and then write it in `autodrive.json` and run it again. **Do not write the suggestion as-is.**


## Egress restriction is not a mechanism that cuts off traffic

**Do not assume "destinations not on the list cannot be reached."** Rules are placed against resolved IPs,
so **destinations sharing an IP with an allowed destination can be reached even if they are not on the list.**
Things behind the same CDN or hosting fall into this.

It was actually measured. With the egress restriction in effect:

| Destination | On the list | Result |
|---|---|---|
| `objects.githubusercontent.com` | Yes | Reachable |
| `raw.githubusercontent.com` | **No** | **Reachable** (same IP) |
| `example.com` | No | Blocked (different IP) |

**It is a mechanism that reduces where traffic can go, not one that cuts off traffic.** Therefore,
**do not treat it as a guarantee that data does not leave.**

**What it narrows is only the traffic this machine sends out (`OUTPUT`).** Traffic passing through
(`FORWARD`) is not narrowed. **Add a feature that runs containers inside to `devcontainer.json`,
and that traffic does not go through the egress restriction.**

What actually protects is something else.

- **Not keeping credentials locally.** Even if traffic gets out, there is nothing to carry out
- **Stopping at fixed conditions.** Irreversible operations go through a human regardless of the egress restriction
- **Records remaining.** What was done can be read afterwards

Do not weaken these and try to make up for it with the egress restriction. **It cannot make up for them.**

## Allowed destinations can become unreachable

**Rules are placed against the IPs resolved at start.** If the destination side swaps its IPs,
**it becomes unreachable even though it is on the list.**

It happens silently. Reading the list, you take it that it is reachable, so **you end up thinking the destination is having trouble or
that you made a mistake.** The most likely reading is "the allowlist entry is not doing its job," but
**usually the entry is correct and the IP just changed.**

If a destination that should be allowed is blocked, run this first.

```sh
{{KIT}}/bin/autodrive-dev-kit sandbox 宛先を確かめる
```

It lists the unreachable destinations. Most are fixed by re-placing the rules.

```sh
sudo bash .devcontainer/init-firewall.sh
```

**Some destinations are unreachable even after re-placing.** Some swap again between placing the rules
and using them (about 2 minutes measured, `developers.google.com`). **A form that pins IPs
cannot keep up, so give up on that destination.**

**The check at start cannot find this.** It looks at only one entry, and right after the rules
are placed, so nothing has swapped yet.

## CI failures can be read down to the log body

**Read them with `gh`.**

```sh
gh run view <run ID> --log-failed
```

**The REST `/actions/jobs/{id}/logs` cannot be used.** It redirects to an Azure blob whose
host name changes per run (`productionresultssa0` / `sa5` / `sa12` …), so
**a list that cannot hold wildcards cannot reach it.**

If you cannot read it, first check "can become unreachable" above. **Not being able to read it
is different from not being allowed.**

If you only need where it failed, that can be taken from `actions/runs/<ID>/jobs`. **When the body is not needed,
this is faster.**

## Exposure can be reverted but not undone

**Deployment being reversible and exposure being reversible are different things.**

A deployment can be redone. Publication can also be stopped. But **what was seen while it was public
cannot be undone.** Therefore "it can be reverted, so there is no need to stop" does not apply to exposure.

**The verification environment is included.** Not being production does not make it lighter. A verification environment normally holds
production-equivalent credentials and data, and there is no reason to make its reachability the same as production.

There was a report that a verification environment was created in a public state, and this convention comes from that.
**Only the reversibility of deployment was looked at, not exposure.**

What to check.

| What to check | What to look at |
|---|---|
| Who can see it | Public / only allowed accounts / internal only |
| Whether that is fine | **Ask the human. Do not publish by default** |
| Whether it can be checked while staying closed | If checking how it looks needs publication, **ask the human including that** |

**"It had to be public to check how it looks" is not a reason.** If publication is needed
for checking, that itself is a point to put to the human.

### Whether it is open is always measured before saying so

**Do not judge by the response code alone.** Protected places also return redirects. Without looking at the redirect **target**,
you cannot tell whether it is open or closed.

```sh
curl -sS -D - -o /dev/null https://<destination>/ | grep -i "^HTTP\|^location"
```

| What you see | How to read it |
|---|---|
| `200` | Open (no authentication in front of the app) |
| `302`, and the redirect target is the entrance to authentication | **Closed** |
| `302`, and the redirect target is a login inside the app | The app protects it. The front is open |

**Skip this check and you will report something closed as "public."** Concluding it is reachable from a 302
alone means that even with authentication in front of the app, you cannot read that it is **protected**.

**Do not write what was not measured as if it had been.** The same goes when investigating a report.
Confirm the report is correct before moving conventions or settings.
