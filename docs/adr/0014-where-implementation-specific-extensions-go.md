# ADR 0014: Where implementation-specific extensions go. Port operations, configuration the adapter reads, or the implementation's own tools

- Status: Accepted
- Date: 2026-10-14
- Work item: ADK-134

## Background

A project using this reference implementation with Linear needed work items filed under a specific Linear project. `tracker file-work-item` had no way to do that.

The direct answer is to add an option such as `--project`. **A human raised that this will not be the last such request:** more extensions that depend on a particular implementation will come, and adding an option each time does not scale.

### Why an option on the operation does not fit

`file-work-item` is port vocabulary (definition §16). **Every implementation has to give it the same meaning.** A Linear project has no counterpart with the same meaning on GitHub Issues: Projects and milestones exist, but neither is "the place a work item belongs to" in the same sense. An operation option that means something on one implementation and nothing on another is an implementation name leaking into the vocabulary.

### What decided it

**The human answered that the project is decided per repository, not per work item.** Every work item from a repository goes under the same project. That makes it a setting, not a choice made at each operation.

## Decision

**Implementation-specific extensions go in one of three places, by their nature.**

| Nature of the extension | Where it goes | Examples |
|---|---|---|
| Every implementation has an operation with the same meaning | **Port operation** | Filing, advancing the status, appending to the work log |
| Specific to an implementation, decided per repository, and does not change | **`autodrive.json`, read only by the adapter** | `tracker.prefix` (GitHub Issues), `tracker.project` (Linear) |
| Specific to an implementation and done case by case | **Not wrapped.** Use the implementation's own tools (its screens, MCP, `gh`) | Moving one work item to another project, bulk edits |

The third row is ADR 0007 extended from automation to operations: **what the implementation already provides is ridden on, not rebuilt.**

### `tracker.project`

- Written in the `tracker` section of `autodrive.json`, next to `tracker.prefix`. The name, slug, or ID of the project
- **Only the Linear adapter reads it.** Callers and the vocabulary do not change
- **If it is written but cannot be honored, it stops.** If the project is not found, or several projects share the name, filing stops and lists the candidates. If the Tracker is not Linear, assembling the Tracker stops. **A setting that is written but silently ignored looks, to the person who wrote it, like a setting that works**, while unlinked work items keep piling up
- While doing this, it turned out that `createTracker` treated an unreadable `autodrive.json` as "no configuration" and assembled Linear. That would have silently dropped a malformed `tracker.project`. **It now stops with the reason**

## Remaining

**The team is still given by an environment variable** (`AUTODRIVE_TRACKER_TEAM`), while the prefix and the project are in `autodrive.json`. By the table above the team belongs in the second row. Moving it is left to a separate work item: environment variables are already set where this has been distributed, and changing where it is read would stop them silently.
