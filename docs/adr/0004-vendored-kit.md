# ADR 0004: autodrive-dev-kit is copied into the project and pinned by version

- Status: Accepted
- Date: 2026-08-27
- Work item: AUT-75

## Background

In the first design of `init`, the project **pointed at the local reference implementation.** Relative paths were written in the settings, and the conventions also named the reference implementation's commands.

A human pointed this out.

> Considering that the kit will keep being updated, the scripts that run in each project should be self-contained within the project. **Because there could be a situation where PJ1 runs on kit version 1 and PJ2 on kit version 2.**

**The same hole had already appeared.** The CI of three repositories fetched the reference implementation with `git clone --depth 1` every time. Since it always took the latest, **a change that broke the reference implementation would fail the CI of all three repositories at once.**

Furthermore, the `kit_version` attached to records was fixed at `bootstrap`. Definition §6 makes this attribute required so that records can be compared later, and **if everything has the same value, there is nothing to compare.**

## Decision

**autodrive-dev-kit is copied into the project.** It is placed in `autodrive/` and tracked.

- What is copied: `src` / `hooks` / `bin` / `invariants` / `VERSION` / `package.json` (**[ADR 0010](0010-distribution-boundary-in-the-tree.md) later moved the location to `src/vendored/` instead**)
- **Tests, documents, and templates are not copied.** The project does not run `init`
- The version is placed in `VERSION` and **read at run time.** Holding it as a constant would require rewriting on every copy
- Replacement **throws the whole thing away and then places it.** If remnants of the previous version mix in, it becomes unreadable which version is running

## Why

**Without a pinned version, the project gets caught up in changes to the reference implementation.** Those caught up have no way of knowing what changed when.

It is tracked **because it is not pinned unless it is in the history.** Merely having it locally means a different version in a different environment.

## What this decision produces

**CI no longer fetches the reference implementation.** The copy is inside, so the clone disappears. So does fetch failure as a source of outages.

**`kit_version` gains meaning.** Comparing records shows which version was running.

**Updates to the reference implementation do not arrive at the project automatically.** This is an intended property. To bring them in, run `update`.

**That `update` is fetched from outside and run.** The copy does not include the templates, so it cannot place files from the copy. This was not explained, and a description telling people to run it in the copy remained in `templates/autodrive.md` (AUT-152). Now, if run from the copy, it stops with the reason and how to run it.

**There is no way to run it that applies only the configuration (`autodrive.json`).** Applying it means fetching from outside, and the version goes up then. If a means of choosing the version is needed, tags are needed (AUT-155).

## Rejected options

- **Keep pointing at the reference implementation** — Rejected. The version cannot be pinned. The same problem has already appeared in CI
- **Do not copy; only record the version** — Rejected. The record remains, but what runs is still the latest, so it is not pinned
- **Distribute as a package** — Rejected. It does not fit the zero-dependency policy (ADR 0001), nor the reference implementation being something that should be read. A copy can be read as it is

## Unresolved

**Some things are not ports yet.** Repo (GitHub's shape shows up directly in the checks), Runner (CI is a string), and the kind of agent (the recording hook depends on the shape of Claude's session record).

**Do not abstract now.** Adding ports with no second implementation produces an abstraction that is just the first one's shape. Evidence that a port works appears only when a second one comes in.

The cost of adding them later is high in this order. **The kind of agent is the highest, and it bears directly on an invariant (records remaining automatically).**

| | Cost | Reason |
|---|---|---|
| Kind of agent | High | The recording hook depends on the shape of the session record |
| Runner | High | CI is a string. Each kind is a different thing |
| Repo | Medium | Few places call it; it is local |
| Kind of app | Low | Mostly swapping templates |

Templates were **moved out into files** from strings in the code because of this outlook. When swapping per kind of app or kind of agent, only the location needs to change. **Cheap now, pays off later.**
