# ADR 0009: Records are linked to work items by the branch of the repository you are currently in

- Status: Accepted
- Date: 2026-09-12
- Work item: AUT-172
- Related: [0002](0002-token-usage-capture.md) (supersedes the means of linking)

## Background

Records were linked through a single marker (`.autodrive/current-work-item.json`). ADR 0002 placed it, and it is overwritten on every start.

**There is only one marker, and it is swapped on the next start.** But records are not written in the order work is started.

```
1. Submit AUT-162
2. Start AUT-174      → the marker points at AUT-174
3. A human comments on AUT-162 → fix it and write a record
```

**The record written in 3 is linked to AUT-174.** Comments arriving after submission are normal, and at that point the marker always points at the next one.

### Worse than not being attributed

Three records actually pointed at the wrong place (2026-09-12).

| Record | Correct work item | Where the marker pointed |
|---|---|---|
| Missed detection of AUT-170 | AUT-170 | AUT-174 |
| Decision of AUT-162 | AUT-162 | AUT-174 |
| Rework of AUT-162 | AUT-162 | AUT-174 |

**Not being attributed is reported as a count by `invariants`. Being attributed to the wrong work item is noticed by nobody.** Definition §6 makes the work item ID a required attribute that cannot be attached retroactively. A wrongly attached value cannot be fixed, for the same reason.

### Another symptom: the result changes with where it is run

When the recording command was run from inside a child repository, the starting point became that directory, and neither the marker nor the session record was found.

The reason left then was "possibly an exchange not linked to a work item," but **that is a wrong explanation.** What was missing was not something to link to, but the place searched. **A wrong reason left behind misleads whoever reads it later.**

## The premise of ADR 0002's grounds had changed

ADR 0002 said "`gitBranch` in the session record is `HEAD` on every line, so the idea of looking it up from the branch name does not hold."

**Measured now, the actual branch is in each line** (2026-09-12, confirmed over 800+ lines in one session). The observation at the time was right; the runtime side changed.

**However, what this ADR adopts is not the session record.** It looks at the working tree itself at the time of writing, so as not to depend on the runtime's circumstances.

## Decision

**Look it up by the branch of the repository you are currently in. If not found, look it up by the marker.**

```
write a record
  → find the repository containing cwd (limited to the starting point itself, or directly under it)
  → read that repository's current branch
  → look it up in the mapping (.autodrive/work-items.json)
  → if not there, fall back to the marker
```

**Branches are separate per work item and are not swapped when moving back and forth.** Records written after going back also go to the right place.

### The work item ID is not guessed from the branch name

`begin` writes down the mapping. Working backward from the shape of the name misses when a different name was passed with `--branch`. Worse, **it would make up nonexistent IDs from branch names that are not work items.**

The mapping is **added to, not cleared.** As long as a previous work item's branch remains, records written after returning there are linked correctly. That is the purpose of this table.

### Only what is under the starting point is accepted

Limited to the starting point itself, or repositories directly under it. So that when run outside, unrelated mappings are not picked up.

It does not look up on a detached HEAD (the branch name is empty).

### The starting point is searched upward

`CLAUDE_PROJECT_DIR` has top priority. Otherwise, it goes up until it finds a directory with `.autodrive`. **So that the result does not change with where it is run.**

### The marker is kept

Not deleted. It is needed as a fallback when the branch cannot be used (on the default branch, not in the mapping).

## Relation to parallel execution

**It meshes with the form of creating a worktree per work item.** Each worktree has its own branch, so however many run at once, they do not get mixed up. A single marker could not express this in the first place.

## Consequences

- **Linking to the wrong work item no longer happens.** The three that actually occurred can all be looked up correctly from the branch
- **It links even when run from inside a child repository.** Wrong reasons no longer remain in the records
- One more state file (`.autodrive/work-items.json`). It is working state, not a deliverable, so it is not put in the repository
- **Records wrongly linked in the past were not fixed.** Work item IDs can neither be attached nor corrected retroactively (definition §6). The error is kept as a record
