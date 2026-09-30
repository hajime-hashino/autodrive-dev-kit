# Commands

**The only commands a human runs are `init` / `apply`.** The AI runs the rest. This lists all of them; read it when working on the reference implementation, or when checking what the AI does.

`update` is also run by the AI. **It is a change that rewrites files the project tracks, so it goes through a submission** (AUT-150).

The entry point is gathered into one: `src/vendored/bin/autodrive-dev-kit`. **So that putting it on PATH adds only one thing.**

The contents of `src/vendored/` become the project's `autodrive/` as they are. **So the path from the shell to the implementation is the same in the reference implementation and in the copy** (`invariants` → `internal/main.js`).

## Placing the foundation

```sh
autodrive-dev-kit init      # start new. asks about the setup
autodrive-dev-kit apply     # add to an existing project. infers the setup and confirms it
autodrive-dev-kit update    # replace with a newer version. does not ask about the setup
```

**They differ only in how the setup is decided; the placing steps are the same.** If a precondition is broken, it stops without placing and says which one to run.

### Placing needs the templates

These three read the templates (`src/templates/`) to create files. **The copy inside the project (`autodrive/`) does not include the templates** ([ADR 0004](adr/0004-vendored-kit.md)).

Therefore `update` is **fetched from outside and run.**

```sh
npx github:hajime-hashino/autodrive-dev-kit update
```

If run from the copy, it stops without placing and prints this way of running it. **Failing without a reason leaves whoever ran it not knowing what happened** (AUT-152).

The setup remains in `autodrive.json`. **It belongs to the project and is not overwritten on replacement.** The background of the design is in [ADR 0005](adr/0005-project-config.md).

### If they were changed by hand, it stops without overwriting

Managed files (`.devcontainer/`, `.env.example`, `docs/autodrive.md`, CI definitions) are rewritten on every replacement. **If they were changed by hand, it writes nothing and stops.**

```
Managed files were changed by hand. **Replacing them as-is would erase those changes.**

  .devcontainer/devcontainer.json
      "ghcr.io/devcontainers/features/python:1": { "version": "3.12" },
      "forwardPorts": [5432],

**Nothing was written.** So as not to leave a partially updated state.
```

**It does not write partway and then stop.** Checking while writing would leave a state where only autodrive-dev-kit is new and the managed files are old.

The judgment compares against the fingerprints from when they were placed (`autodrive/manifest.json`). **It does not stop for what the reference implementation side changed.** Stopping there would make replacement itself impossible.

The fingerprints are kept in `autodrive/` **because that is tracked.** `.autodrive/` is not tracked, so the judgment would differ between someone who changed a file by hand and committed it and someone who cloned.

If there are no fingerprints (projects placed before this mechanism), it **does not stop**, because it cannot tell a change by hand from the previous version's contents. But **it does not stay silent about what it did not confirm.**

```
Could not confirm whether these were changed by hand (1). **Overwrote them.**
  .devcontainer/allowed-domains.txt
```

**The form "the AI merges every time" is not adopted.** The managed files include `init-firewall.sh`. A wrong merge opens outbound traffic, and **that it opened cannot be noticed even by the checks.** Right now, "the contents match the template" can be confirmed mechanically. Merging would erase that guarantee.

Judging whether to take something in after it stops **is needed only when it is detected.** The risk is not taken on every time.

## Starting work

```sh
autodrive-dev-kit begin <work item ID> --repo <target repository> [--branch <branch name>]
```

Starting needs three things: checking the work item, preparing the workspace (bringing the default branch up to date and creating a branch), and placing the link for records. **Stepping through them by hand, you cannot notice having skipped one.**

In addition, **the target repository is noted on the work item itself.** It used to be written only in the local marker, so looking at the Tracker's list did not tell which repository a work item was for (AUT-114).

There are three failures in the records, and in each case the convention was stated explicitly.

| Work item | What was skipped |
|---|---|
| AUT-38 | Did not return to the default branch and stacked on an integrated branch. The change never arrived |
| AUT-42 | Left the marker pointing at the previous work item |
| AUT-42 | Committed directly to the default branch without creating a branch |

**Even if a convention exists, without going through the procedure there is no occasion to remember it.** Placing an entrance without which nothing starts reduces the need to remember in the first place.

If a precondition is broken, it stops without proceeding. **When it stops, it says why, and what to do.**

```
my-app is currently on aut-48-begin-work (the default branch is main).
Starting on top of the previous work's branch means the changes never arrive if that submission is closed.

Do one of the following.
  - If the previous work is integrated: git -C my-app fetch origin main:main && git -C my-app checkout main
  - If it is not submitted yet: submit that work first, then start
```

Local changes are not deleted. They are carried over to the branch, and it says what was brought over.

**When returning to the default branch, bring it up to date first.** That is why the guidance includes `fetch`. Switching without doing so makes the integrated records and the local records disagree, and switching fails if there are uncommitted additions.

**Records written after the submission are carried over to the next branch, not thrown away.** If the default branch has been brought up to date, additions are carried over as they are.

### Starting reports records left behind; it does not pick them up

Records can be left behind. **The order is fixed.**

1. Commit
2. Submit
3. Report to the human and stop → **anything written here is after the commit**
4. Move on to the next work. The branch changes

**3 always comes after 1.** So what is written at the end is structurally never in that work item's commit. Not because someone forgot (AUT-156).

**`begin` says so when starting. It does not pick them up** ([ADR 0008](adr/0008-token-usage-off-branch.md)).

```
**There are records left behind.** They are not picked up here (they would mix into another work item's submission).
  telemetry/AUT-155.jsonl
Check which work item they belong to. If it is the one just started, they may be submitted together with
this work's changes. If they belong to another work item, **put them on that branch.**
```

It used to pick them up and commit them right after creating the branch. **That put another work item's records into the submission of the work item just started** (of 115 lines of token records, 93 went in with another work item's commit). Changes unrelated to the work mixed in and misled whoever read the diff.

Since token consumption is now sent outside the repository (ADR 0008), what is written to `telemetry/` is limited to what the AI working on that work item writes itself, and it can commit that itself. **There is no one to pick up after.** Still, some may remain, so it says that they exist.

**It does not touch other repositories either.** Because a work item writes changes to only one repository. It says that they exist; they ride along the next time work starts in that repository.

## Port vocabulary

The vocabulary of definition §16 is used as the names of the entry points as it is. **Callers do not know implementation names.** When swapping, replace only what is inside `src/adapters/`.

```sh
autodrive-dev-kit tracker get-work-item [<ID>]
autodrive-dev-kit tracker file-work-item --title <title> --body <body>
autodrive-dev-kit tracker advance-status <ID> --to started --repo <target repository>
autodrive-dev-kit tracker append-to-work-log <ID> --text <text>
autodrive-dev-kit tracker edit-work-item-body <ID> --body <body>

autodrive-dev-kit telemetry record-stop              --kind <kind> --type <input|rework> --detail <details>
autodrive-dev-kit telemetry record-rework            --target <target> --detail <details> [--cause <cause>] [--found-in <stage>]
autodrive-dev-kit telemetry record-spot-check        --area <area> --looked <range looked at> \
                                                      --not-looked <range not looked at> --detail <details> [--fixed]
autodrive-dev-kit telemetry record-delegation-change --area <area> --from <state> --to <state> --detail <details>
```

**The operation names are joined with hyphens** (`record-stop` for "Record stop"), since names with spaces would need quoting every time (AUT-267). The Japanese names of the definition before v0.19 are still accepted; when one is used, the command says what it has been renamed to. The mapping is in the definition's CHANGELOG (v0.19).

**The values are in English too** (`--type input|rework`, `--cause requirements-drift|design-drift|implementation-bug`). Japanese values of earlier versions are accepted and written in English. **Records already written keep their Japanese values** (records are not rewritten retroactively, definition §6); the checks and the quality evidence read them as the same values.

**The body can be edited only before work starts (`backlog` / `todo`)** (definition §16). After work starts, the body is the record of "what was asked for," and making it rewritable **makes it impossible to confirm "whether it was built as asked."** Corrections after work starts are made with `append-to-work-log`. When it refuses, it also says where to go instead.

**There are two ways of stopping** (`--type`). Do not lump them together. Stops to obtain input (asking what to build, having them decide how it looks, asking for credentials to be issued) are **evidence that the method is working correctly, not something to reduce.** What to reduce is the rework side. **Asking the same thing again is rework, not input.**

**Always record spot checks, even when nothing was corrected.** Definition §8 judges loosening by "N consecutive times without correction," so the judgment does not hold unless the times without correction remain. The range not looked at cannot be omitted for the same reason.

Whether something was corrected is held as a boolean, not a count. As a count, a correction rate could be calculated, opening the way to a use §8 forbids.

**Required attributes (work item ID, model, reference implementation version, write path) are not passed.** The adapter attaches them automatically (supplementary notes to definition §16). Making them passable would mix records where they were forgotten with records where they were passed, and it could not be fixed retroactively.

### Starting is where linking begins

`advance-status --to started` writes the work item marker. Records from then on are linked to that work item. **If a record is produced without having started, `work_item_id` becomes `null` and `invariants` fails.** The fact of working without filing is detected without erasing it from the records.

`--to done` / `--to canceled` removes the marker, so that records of another work item do not slip in.

### There is no operation here for marking done

**What moves integrated work items to done is the Tracker–Repo integration** (ADR 0007). `begin` does not close them.

`begin` used to close them as a side effect of starting. **It looked at only the one repository being started in, so items were left behind when moving across several repositories** (AUT-165). An integration moves at the moment of integration, in any repository.

If it ever needs to be closed by hand, use `tracker <ID> --to done`. **Normally it is not run.**

**The checks notice when the integration is not working.** `invariants` reports "work items still started though integrated" as an observation. The same signal appears whether the setting was forgotten or came off partway.

### Tracker implementations

Decided by `ports.tracker` in `autodrive.json`. **Callers do not know implementation names** (definition §16). Only `ports/trackerFactory.js` assembles them.

| Implementation | Work item ID | How state is held | Credentials |
|---|---|---|---|
| `linear` | Held by the Tracker (`AUT-123`) | Held by the Tracker | `LINEAR_API_KEY` |
| `github-issues` | Prefix + number (`AIEP-123`) | Labels while open, the reason once closed | `GH_TOKEN` (`AUTODRIVE_TRACKER_TOKEN` to keep a separate one) |

What `github-issues` lacks is **filled in by the adapter.** Details, and why, are in ADR 0013.

**For both, moving to done is left to the integration.** On GitHub, writing `Closes #<number>` in the body of the submission closes it on integration. **A prefixed ID does not close it** (GitHub reads the number).

## `invariants`

```sh
# judge across the whole working directory (default)
autodrive-dev-kit invariants --root /path/to/work

# limit to judgments that are complete within one repository (for each repository's CI)
autodrive-dev-kit invariants --root . --scope self

# machine-readable output
autodrive-dev-kit invariants --root . --format json
```

The full criteria are in [invariants.md](invariants.md).

Judging the invariant "The AI cannot disable any of these" reads the Repo API, so the environment variable `AUTODRIVE_CI_TOKEN` is needed. Without it, it fails as unjudgeable (definition §9, "a state in which it cannot be judged whether something is active is itself treated as a failure").

```sh
set -a; . /path/to/work/.env; set +a
autodrive-dev-kit invariants --root /path/to/work
```

### Advancing the activation boundary

```sh
./invariants --enact telemetry_recorded
```

Advances where judging starts. Records from then on are judged. Used to restore things after a failure fell back to direct writes and the adapter has been fixed.

Refused if the hook that records automatically is not registered in `.claude/settings.json`. The activation boundary record is written through the adapter, so **it cannot advance if the adapter is broken.** There is no path to claim active while writing directly.

Details are in [ADR 0003](adr/0003-enactment-boundary.md).

### Recording a substitution

```sh
./invariants --substitute boundary_change_logged --by human --detail "the delegation table is placed in stage 3"
```

For an invariant that is not active, records what is substituting for it by hand. **The bootstrap-phase exception in definition §9 is conditional on this record existing.** Without the record, `invariants` fails.

**Refused for an invariant that is already active.** Adding a substitution record where none is needed would leave an old record behind when active falls, misleading the judgment.

The record is written through the adapter. The property that writing it by hand makes active fall is kept.

### Exit codes

| Value | Meaning |
|---|---|
| 0 | No failures. Even with invariants that are not active, 0 if substitutions are recorded |
| 1 | There is an invariant with no substitution record, or an invariant that cannot be judged |
| 2 | Invalid arguments, or no repository to judge was found |

**Being substituted is not itself a failure.** What is a failure is having no substitution record, and not being able to judge.

### It can be run from outside the agent

`invariants` is an executable file, and does not take the form of existing only as a slash command. That form could not prevent the accident of operating on without it ever being connected to the agent. For running it from CI, see [.github/workflows/invariants.yml](../.github/workflows/invariants.yml).

## `quality`

```sh
# produce the quality evidence (cross by default)
autodrive-dev-kit quality --root /path/to/work

# within one repository only
autodrive-dev-kit quality --root . --scope self

# machine-readable output
autodrive-dev-kit quality --root . --format json
```

**Unlike `invariants`, it is not a judgment.** It returns no pass / fail, and its exit code does not express good
or bad. It only lays out material for the reader to judge.

**No score is given because definition §1 closes that off.**

> **This purpose is not measured directly as a metric.**… **Put a standard that cannot be measured into a metric,
> and it can be declared achieved.**

What it shows.

| | Source |
|---|---|
| What was decided to check | Each repository's `docs/quality.md`. **Unfilled fields are shown too** |
| Errors that actually slipped through | Missed detection records. Breakdown by stage where found and by cause |
| Rework | Rework records. Breakdown by cause |
| What humans looked at | Spot check records. **The range not looked at is always attached** |
| Grounds for moving what is delegated | Delegation change records |

**It does not silently show 0.** It distinguishes 0 with records present from no records at all.
**It always attaches the denominator (the number of records and of work items).**

## Recording token consumption

Called from the runtime's hook, it reads usage from the session record and **sends it over OTLP to the configured destination** (`AUTODRIVE_OTLP_ENDPOINT`). **It is not written to the repository** ([ADR 0008](adr/0008-token-usage-off-branch.md)). Token consumption is optional (definition §6); with no destination configured, it is not recorded, and it says so.

```sh
./src/vendored/hooks/record-tokens   # takes the hook's input on standard input
```

The hook is registered in `.claude/settings.json` of the using repository, not of this reference implementation. Placing it where `invariants` can read it makes it detectable when removed.

The design, and why other paths were not taken, is in [ADR 0002](adr/0002-token-usage-capture.md) and [ADR 0008](adr/0008-token-usage-off-branch.md).

### Linking to work items

Records are linked to work items **by the branch of the repository you are currently in** ([ADR 0009](adr/0009-attribute-by-branch.md)). `begin` writes the mapping. The marker is the fallback when the branch cannot be used (on the default branch, or not in the mapping). These are placed at the top of the using repository, and not tracked.

```
.autodrive/work-items.json          the mapping from branch to work item
.autodrive/current-work-item.json   {"work_item_id": "AUT-10", "repo": "autodrive-dev-kit"}
.autodrive/cursors/<session ID>.json
```

If a record written with the `telemetry` command cannot be linked to a work item, `null` is written to `work_item_id` and it is kept in `telemetry/unattributed.jsonl` with the reason. **Records are not thrown away.** Erasing work begun without filing from the records would erase the violation too. `invariants` detects this.
