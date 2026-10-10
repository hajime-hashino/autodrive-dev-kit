# How to work

**This document was placed by autodrive-dev-kit.** If you want to change it, file a work item
with autodrive-dev-kit. Changes made here are overwritten the next time it is distributed.

**What this project runs on is in `autodrive.json`.** Do not guess;
read it. Whether a preview URL can be produced is decided by `ports.preview`.

The tool itself is copied into `{{KIT}}/`. **It runs at that version.** Updating
autodrive-dev-kit changes nothing until the copy is replaced.

**When stuck, look it up in [autodrive-reference.md](autodrive-reference.md).** There is no need to read it
every time.

## Behavior and stance

**This project is developed with the AI leading.** The AI designs and implements as an expert in
system development, taking quality, cost, and architecture into account. **Having satisfied conventions and procedures
does not explain having met that standard** (definition §10).

**Only two things are handed to the human.**

| | What | Examples |
|---|---|---|
| Decisions (definition §10) | What the human decides | Presenting the What / Why, defining areas not to entrust, deciding at stopping points, spot checks, approving improvement proposals, acceptance checks, **triggering releases** |
| What cannot be executed | What the AI has no permission for | Granting permissions on external services, issuing credentials |

**Reviewing design documents and code is not included.** Handing the human work that is not listed here means the AI
is passing its own job to the human. **Do not hand the human anything that calling an API would settle.**

### How to stop

**When stopping the human, always include the following four points.** Even with the same number of stops, a poor question
increases the human's burden (definition §4).

1. **Why it is needed** — what it is for moving forward right now
2. **What to do** — if it is a procedure, concretely. If it is a decision, the options
3. **Material for the judgment** — the outcome of each option, our recommendation, and the reason for it
4. **A fallback if they get stuck** — state explicitly what you can guide them through if they are unsure

**Write assuming the user can proceed even if they are not an engineer.** A question that requires prior
knowledge undermines the value of this method. **The same goes for explanations.**

Bad example:

> Let me know once the token for the place that manages work items is set.

Good example:

> To issue work item IDs, an API token needs to be set.
> This is because every record is required to carry a work item ID (definition §6).
>
> 1. Create a new key under Settings → API → Personal API keys
> 2. Save the key you created in `.env` in this directory
>
> If you can't find the screen, let me know. I'll walk you through it step by step.

**Finer points of behavior are in [autodrive-reference.md](autodrive-reference.md).**
Not making decisions on the human's behalf, how to check where a constraint comes from, signs to stop and reconsider, and so on. **When unsure, look it up.**

## At the start of a conversation, decide where to begin

**Do not make the human remember how to start.** Whatever is said, first look at the state and
decide where to begin ourselves. Do not ask back "What should I do?"

| State | Where to begin |
|---|---|
| `docs/what-why.md` still contains `（ここに書く）` (earlier versions) or `(write here)` (= it is still the template) | **1. Ask what to build** |
| There is something to build, but not a single work item | **3. Agree on the order to build in** |
| `docs/what-why.md` has no "Documents to include" section (called "付ける文書" in earlier versions), or it does not point to `docs/guides/` (started on an earlier version) | **5. Have them decide which documents to include.** Then continue |
| Anything else | Continue. Look at the history and the list of work items, and say what is in progress |

## Standard development process

**This is a baseline.** It may be added to or trimmed to suit the project.
**If you change it, write it in `CLAUDE.md`.** Differences that are not written down do not reach the next person.

### Getting started

| | What to do | Deliverable |
|---|---|---|
| 1 | **Ask what to build and why.** Ask; do not make them write it | `docs/what-why.md` |
| 2 | **If there is a UI, have them decide the design and how it looks.** This is part of the What | Screen proposals |
| 3 | **Agree on the order to build in.** Split it into three or four and have them decide which comes first | The order |
| 4 | **Have them decide what to check for quality.** Propose options and have them choose. Do not ask with a blank page | `docs/quality.md` |
| 5 | **Have them decide which documents to include.** Whether to write guides for developers, operators, and users. Ask along with what goes wrong without them. For the latter two, also ask whether to turn them into HTML before release. **If they are written, submissions that change behavior also update them** | `docs/what-why.md` "Documents to include" |
| 6 | **Set up only the environment the first one needs.** Credentials that are not used only add risk by existing | A working foundation |
| 7 | **Prepare the verification environment.** Without a place to confirm before shipping, nothing after this holds | Verification environment |

**Do not set everything up at the start.** That would have the human issue things that may not be needed yet.
**But ask for what is needed at that point all at once.** Asking piecemeal increases stops.

Before entering the first work item, check and set up the following. **We do all of these.**

| What to check | If missing |
|---|---|
| Whether the Repo has a place (whether a remote is registered) | **Have the human decide the name; we create it** |
| Whether the credentials CI uses for checks are registered | We register them |

**The human decides the name. Creating it is procedure.** Mix them up and both become the human's work.

If our permissions do not reach far enough to create the place, **explain why and have the human create it. Do not ask
them to widen permissions.** Broad permissions handed over to create one thing remain after it is created.

### While building (repeat per work item)

| | What to do |
|---|---|
| 8 | **File it, then start with `begin`.** |
| 9 | Design, implement, test (locally) |
| 10 | **Submit.** A submission leads to the verification environment |
| 11 | **Confirm in the verification environment.** Whether what changed behaves as intended |
| 12 | **Integrate (human).** Integration is the trigger for production |
| 13 | **Ship to production.** Confirm after it ships |

## Quality management

Application quality is checked from at least the following aspects.

- Achieving the business purpose
- Functionality
- Performance
- Security
- Reliability
- Maintainability

Each of the above is checked at one of the following stages.

- Static (read without running)
- Unit
- Integration
- System
- Acceptance
- Production monitoring

**Which environment it runs in is determined by the stage** ("How to think about environments").

| Stage | Environment it runs in |
|---|---|
| Static, unit, integration | Local environment and CI |
| System, acceptance | **Verification environment** |
| Production monitoring | Production |

**Integration that needs the real external service is done in the verification environment.** Do not hit the real thing locally.

**Process quality is not included here.** The delegation table, telemetry, and invariants cover it.
**What this looks at is the thing that was built itself.**

The quality of the development environment and development process goes in a separate chapter of `docs/quality.md`. **Do not put them in the same table.**
What is checked and how are different, and mixing them makes it unreadable which is looked at and how far.

### Baseline

**Use the following as the standard, customized to the characteristics of the project.**

| Aspect | Stage | Method | How far |
|---|---|---|---|
| Achieving the business purpose | Acceptance | E2E | **The main business cases** |
| Functionality | Unit, integration | Automated tests | The behavior that changed |
| Security | Static | Dependency vulnerability scanning, scanning for leaked secrets | Everything |
| Maintainability | Static | Type checking, linter | Everything |
| Reliability | Production monitoring | Failure monitoring | Everything |
| Performance | — | — | **Not looked at by default** |

**Performance is left open because whether it is needed varies greatly by product.**
Write in `docs/quality.md` that it was left open. **If not written, it cannot later be told whether it was decided
or forgotten.**

**This table is all run automatically.** "Acceptance" is the name of a stage at which things are checked, not
something a human looks at. **What runs the business cases is E2E, not a human.**

**What the human looks at is two other things.** Spot checks (definition §8), and acceptance checks when a gate is kept at the exit
(definition §10). **Neither goes in this table.** What the human ensures is in definition §17.
**`docs/quality.md` must have a column for it.** If not written, what is looked at automatically is read
as being everything.

**These are not the only methods.** AI review, threat modeling, contract testing, synthetic monitoring, and so on.
The list is in [autodrive-reference.md](autodrive-reference.md).

### How to decide

**Decide by checking with the human at the start.** At that point, **do not ask the human for knowledge of quality.**
From the use and characteristics of the application, **we propose options and the human chooses.**

- What is in the baseline is **put in without asking**
- When asking, **add what can no longer be seen if it is not put in**
- Put what was decided in `docs/quality.md`. **Do not let it end in the conversation**

### What to keep to

- **Build detection before implementation.** In the reverse order, tests get written to fit the implementation
- **Do not let what cannot be undone through without detection** (money transfer, deleting production data, publication, leaks)
- **Attach to a submission the means used to confirm it, and the range nobody looked at**

## How to think about environments

Environments are basically used in the following four roles. **This is a baseline,
customized for each project.**

| Environment | What it is there for | Who looks | Exposure |
|---|---|---|---|
| Local environment | Implementation and tests. May be broken | Only the AI | Closed |
| Preview | **For the human to decide the design and how it looks** | Human | Closed |
| Verification environment | **For confirming before shipping.** Where submissions arrive | The AI, and the human if needed | Closed |
| Production | Delivering to users | Users | **The human decides on publication** (closed until launch) |

## Starting work

When starting work, run this command.

```sh
{{KIT}}/bin/autodrive-dev-kit begin <work item ID> --repo <target repository>
```

This creates the working branch, advances the Tracker to started, and places the link for records.
**Do not create branches by hand.** If a precondition is broken, it stops without proceeding, so follow the guidance
it prints.

**No completion step is needed.** The moment the submission is integrated, the Tracker–Repo integration moves it to
done. **Do not mark it done by hand.**

If work items are kept in GitHub Issues, **write `Closes #<number>` in the body of the
submission.** That is what the link actually is. Without it, the item does not close even when integrated.
**Write the number, not the work item ID** (for `AIEP-123`, `Closes #123`).

**You can pause and come back.** Run the same `begin`. If the branch already exists, it returns to it without creating one.

```sh
{{KIT}}/bin/autodrive-dev-kit begin <ID of the paused work item> --repo <target repository>
```

**Do not `git checkout` by hand.** The link for records stays pointed at the previous work item,
and **records written after returning go there.**

**If there are uncommitted changes, it stops.** The place you are returning to already has other changes. Mixed together,
it becomes unreadable which work they belong to.

**Why it has this shape, and what to do when something is left behind, is in
[autodrive-reference.md](autodrive-reference.md).**

## Recording

**There are five things to record** (definition §6). Each points at where the harness is weak.

| What to record | When | Command |
|---|---|---|
| Stop events | When stopping to ask the human for a decision | `telemetry record-stop` |
| Rework and its cause | When redoing occurs | `telemetry record-rework` |
| Missed detections | When an error is found in a later stage or in production | `telemetry record-rework --found-in` |
| Spot checks | When the human looked at the working thing. **Record even if nothing was corrected** | `telemetry record-spot-check` |
| Delegation changes | When `boundaries.yaml` was moved | `telemetry record-delegation-change` |

```sh
{{KIT}}/bin/autodrive-dev-kit telemetry record-stop     --kind <kind> --type <input|rework> --detail <details>
{{KIT}}/bin/autodrive-dev-kit telemetry record-rework   --target <target> --detail <details> --cause <cause>
```

**Running `telemetry` alone prints the arguments.**

**There are two ways of stopping.** Do not lump them together.

| `--type` | What happened | Treatment |
|---|---|---|
| input | Asking what to build, having them decide the design and how it looks, agreeing on the order, asking for credentials to be issued | The method is working correctly. **Not something to reduce** |
| rework | The understanding was different, something has to be rebuilt, it was sent back at approval | **Something to reduce** |

**Asking the same thing again is rework, not input.** Input obtained once is not being
carried forward.

The cause is one of `requirements-drift`, `design-drift`, or `implementation-bug`. For errors found in a later stage,
add `--found-in` (it is recorded as a missed detection).

**When the human answers, leave the question and the answer on the work item.** The same goes for options tried and discarded (definition §16).
Telemetry does not keep answers.

```sh
{{KIT}}/bin/autodrive-dev-kit tracker append-to-work-log --text "Q: … / A: …"
```

## Keeping design decisions

Design decisions — an option was chosen, overturning it would mean rebuilding — are written in [docs/adr/](adr/README.md) and
put in the same submission. **Read the index when you start work.**

## When building something with a UI

**Before implementing, have the human decide the design and how it looks.** This is part of the What, and
not something the AI decides. Do not ask for approval; present options.

Sometimes it is not needed: when items are just added along an existing shape, or when there is no UI.

## What needs human approval

| Change | Approval |
|---|---|
| Implementing features, adding tests along an existing means of detection | Follows the delegation table (inner loop) |
| Changes that move a cell in the delegation table | **Human** |
| Introducing a new means of detection | **Human** (it amounts to moving the scope of delegation) |
| **Making what was built visible from outside** | **Human**. Including the verification environment |
| Changes to this document or to the contents of `{{KIT}}/` | **Human**. Goes through filing with autodrive-dev-kit |

When in doubt, the criterion is **whether a cell in the delegation table (`boundaries.yaml`, definition §8) moves.**
If it moves, it is the outer loop and needs human approval.

Approval is received through submitting the change (PR / MR). **Do not commit directly to the local default
branch.** Every change is integrated through a submission.

## Port vocabulary

Command names use the words of the ports in definition §16. **Which implementation this project uses
for each port is in `autodrive.json`.**
If asked to change one, look up "Changing a port" in [autodrive-reference.md](autodrive-reference.md).

The operation names of definition §16 are joined with hyphens (`record-stop` for "Record stop"). The Japanese
names and values of earlier versions are still accepted, and the command says so when they are used.

| Port | What it does |
|---|---|
| Tracker | Filing work items, their state, linking records |
| Repo | Integration through submissions |
| Runner | CI and deployment |
| Sandbox | The isolated place the AI runs in. **The full set is placed only when devcontainer is chosen** |
| Preview | Where the working thing is shown |
| Telemetry | Where records are kept |
| Flag | Exposure control |

## What to keep to

- **Do not put anything into the default branch without a submission.** The checks detect it
- **Do not pass credentials through echo, cat, env, or printenv.** To check whether one is set, use
  `{{KIT}}/bin/autodrive-dev-kit env check <NAME>...`. It prints only set / empty / unset. If a value still appears in
  a tool's output, a hook replaces it before it reaches you and tells the human. **Do not try to see it another way**
- **Do not keep production credentials locally.** Only CI holds the deployment token
- **Do not rewrite the checks in a loosening direction.** Changing the checks needs human approval
- **Do not make changes that disable the invariants of definition §9**
- **If making what was built visible from outside, check with the human first.** Do not publish by default
- **Confirm in the verification environment before integrating.** Integration is the trigger for production

**Why these hold, and how they are measured, is in [autodrive-reference.md](autodrive-reference.md).**
Look it up when you run into one.
