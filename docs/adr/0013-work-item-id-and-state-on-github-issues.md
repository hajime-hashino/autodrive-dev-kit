# ADR 0013: How work item IDs and state are held on GitHub Issues

- Status: Accepted
- Date: 2026-09-23
- Work item: AUT-234

## Background

Two projects (`augone-team/aiep-app`, `augone-team/claude-agents-sample`) manage work items on GitHub Issues. The reference implementation had only a Linear implementation for the Tracker.

### It could not be chosen

**`ports.tracker` in `autodrive.json` was read from nowhere.** Linear was assembled directly in four places.

```
trackerCli.js:158   new LinearTracker(...)
beginCli.js:429     new LinearTracker(...)
main.js:176         new LinearTracker(...)
credentials.js:178  LINEAR_API_KEY required unconditionally
```

Definition §16 says "only adapters know implementation names." **As long as callers assemble implementations by name, it is not in that shape.** Adding an adapter alone does not make it choosable.

### The implementations have different things

| What the port needs | Linear | GitHub Issues |
|---|---|---|
| Work item ID | Holds `AUT-123` itself | A per-repository number `123` |
| Five states | States can be defined freely | Only open / closed and the reason for closing |
| A field for the target repository | None (covered by labels) | None |

## Decision

### 1. Place an entry point that reads the configuration and returns the implementation

`ports/trackerFactory.js` is placed, and callers do not write implementation names. **This is the last place implementation names appear.**

**It distinguishes and returns the reason it cannot assemble one.** Whether credentials are missing, the configuration is incomplete, or the target cannot be read, the human has different things to do. Returning `null` silently leaves it unclear which.

### 2. The work item ID is `<prefix>-<number>`

The configuration holds a 2–4 character prefix, giving the shape `AIEP-123`.

**`#123` is not used as is.** It passes as a git branch name (confirmed), but **it breaks in the shell.**

```
git checkout #123           ← everything after # is a comment. nothing happens
cat telemetry/#123.jsonl    ← same
```

**Not the number alone either.** It collides across repositories. `telemetry/<ID>.jsonl` is inside the target repository so it does not collide, but `work_item_id` is the key the cross-repository check matches on.

**The prefix is asked.** A suggestion is made from the repository name and shown so that pressing Enter as-is takes it.

At one point it was "write the suggestion without asking and let the human fix it." The hearing entry point was limited to having people choose, and **it said it does not accept free text.**

**It was judging by the wording alone, without reading the reason for the constraint.**

The reason was this.

> Free text **makes the receiving side interpret the meaning**, and what was chosen cannot be read from the record.

**The prefix is not interpreted.** It checks the shape and writes it into the configuration as is. What the reason was protecting was not present here.

So the entry point was fixed instead. **The shape (`pattern`) is held by the question itself.** Answers that do not match are not swallowed; it asks again. **What cannot have a shape decided is still not asked.**

This is the pattern definition §10's "distinguish constraints from your own reasoning" describes. Treating something as a constraint without checking its source **leaves behind designs that work around constraints that do not exist.**

**That it does not collide cannot be confirmed.** Another repository using the same prefix would not be noticed. It is the human who decides.

### 3. State: the open side is distinguished by labels

| Vocabulary | GitHub |
|---|---|
| backlog | open, no label |
| todo | open + `state:todo` |
| started | open + `state:started` |
| done | closed (`completed`) |
| canceled | closed (`not_planned`) |

**No label is placed for backlog.** The state as filed is backlog, and requiring a mark there would make Issues people open normally have no state.

**The reason for closing is looked at.** Reading `not_planned` as done would count what was decided not to do as completed.

**When closing, the open-side labels are removed.** Leaving them would leave a "started" mark on a closed Issue.

**It is possible to start on something closed.** Without reopening, the path for tightening back would disappear.

### 4. `GH_TOKEN` is enough for credentials

**It does not rely on the `gh` CLI.** It calls REST directly with `fetch`. `repoApi.js` already works the same way, and it stays at zero dependencies (ADR 0001). **It does not keep two ways of calling.**

`Issues: Read and write` is added to `GH_TOKEN`. **No new key is lined up.**

To keep a separate one, set `AUTODRIVE_TRACKER_TOKEN` and that is used instead.

**`AUTODRIVE_CI_TOKEN` is not shared.** That one is a read-only key the checks use, and sharing it would let **the side that checks rewrite what it checks** (definition §9).

**Linear's `LINEAR_API_KEY` is not changed.** Places already distributed to would break.

#### A separate key was once required (fixed in AUT-235)

At first, `AUTODRIVE_TRACKER_TOKEN` was required, with this reason.

> Keep it separate from the Repo credentials. Reusing the same value makes it impossible to narrow one of them.

**The reason for separation was mistaken.** `AUTODRIVE_CI_TOKEN` is separated because "the side that checks could rewrite what it checks," not because it can be narrowed.

Between `GH_TOKEN` and the Tracker key there is no such relation. **Both are writable keys the agent holds for its own work, pointing at the same target.** Separating them protects nothing more, and only left the human the effort of preparing two. That is actually what happened.

**The reason for one had been applied as-is to the other.** Separation has different grounds for each reason.

## Options not chosen

| Option | Why not chosen |
|---|---|
| Use `#123` as the work item ID as is | **It breaks in the shell** (above). It collides across repositories |
| Use only the number as the work item ID | The key the cross-repository check matches on collides across repositories |
| Hold state in the Projects v2 Status | **It needs a step to create and link a project first.** Starting fails on targets where it is not prepared, and where it fails is in the hands of people who do not know the convention. Labels can be created on the spot |
| Reduce the vocabulary's states from five to three | That would cut definition §16's vocabulary to fit the implementation. **What the implementation lacks, the adapter fills in** |
| Call the `gh` CLI | Assumes an external command is available locally. **REST is already being called, so there is no reason to add it** |

## Remaining problems

**A mixed `--scope cross` is not handled.** The cross-repository check calls `tracker.list()` on only one implementation. If repositories declare different implementations, the matching does not hold. **It does not happen now** (the workspace runs on one implementation). Decide when it happens.

**Prefix collisions are not detected.** As above, the reference implementation cannot tell.
