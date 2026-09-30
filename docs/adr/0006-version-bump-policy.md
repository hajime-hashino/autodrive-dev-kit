# ADR 0006: The version is raised on every submission, and CI cuts the tag after integration

- Status: Accepted
- Date: 2026-09-08
- Work item: AUT-155

## Background

ADR 0004 copied autodrive-dev-kit into the project and **decided to pin it by version.** What was pinned went only as far as "it does not change until `update` is run," and **what arrived after running it could not be chosen.**

`VERSION` had not moved once since the day ADR 0004 placed it. **Across 164 commits it stayed 0.1.0, and all 270 records had the same value.** Definition §6 makes `kit_version` a required attribute so that records can be compared later, and if everything has the same value, there is nothing to compare. **The problem ADR 0004 set out to fix remained in a different form.**

### What measurement showed

**Even without tags, a version could be pointed at.**

```
npm pack "github:hajime-hashino/autodrive-dev-kit#8ca3174"
→ the contents from the TypeScript era came down (35 .ts files, 0 .js files in src)
```

After `#`, either a tag or a commit ID can be written. So **the problem was not "cannot choose" but that `VERSION` did not move.** Having no readable name comes after that.

**A commit that raises it cannot be pushed directly to the default branch from CI.** The reference implementation itself detects "changes that entered the default branch without a submission" (`src/directCommits.js`), and it would fail there. **The act of raising it has to ride in a submission.**

## Decision

**Raise it on every submission.** The AI raises it, inside the branch. Once integrated, CI cuts the tag.

| What | Who | Where |
|---|---|---|
| Raise `VERSION` and version in `package.json` | The AI | Inside the work item's branch (rides on the submission) |
| Check that raising was not forgotten | The checks | On every submission (the version job in `invariants.yml`) |
| Cut `v<VERSION>` | CI | After integration (`tag.yml`) |

**It is required only when what is distributed changes.** Changes to only tests, documents, records, or the list of mutations do not raise it. Raising it would change nothing on the receiving side.

The list of what is distributed is derived from `VENDORED` in `src/init.js`. **It is not held as a copy.** When what is placed changes, only one side would go stale. That is actually happening with the index (AUT-160).

## Why

**There was no occasion to notice forgetting to raise it.** Even written in a convention, it is not remembered unless one goes through it. It stayed put across 164 commits not because someone forgot, but **because there was no occasion to remember.** For the same reason `begin` was made the entrance, it is placed in the checks.

**Raising it was not made the human's job.** Raising the last number by one is procedure, not a decision. Handing procedure to the human means the AI is passing its own job to the human (definition §10).

**Cutting the tag was given to CI because the fact of integration is in the Repo.** A form where a human transcribes whether it was integrated doubles the record, and only one side goes stale (the same reason as the recording conventions in definition §16).

## What this decision produces

**`kit_version` in records gains meaning.** It takes a different value per work item and can be compared later. The reason definition §6 makes this attribute required is satisfied here for the first time.

**It can be replaced by pointing at a version.**

```sh
npx github:hajime-hashino/autodrive-dev-kit#v0.1.1 update
```

**The number itself does not carry the size of the change.** The last number is raised mechanically, so whether the difference between 0.1.1 and 0.1.2 is large or small cannot be read. If a milestone is to be expressed, the human decides then to raise a middle number.

## Rejected options

- **Raise it only at milestones** — Rejected. Forgetting happens. **This is exactly what is happening now**: it did not move across 164 commits. Records between milestones keep the same value, leaving a range that cannot be compared
- **Drop versions and put the ID of the integrated point in `VERSION` instead** — Rejected. Records would always be unique, but people cannot read them. The phrasing ADR 0004 set up, "PJ1 on version 1, PJ2 on version 2," would no longer be possible
- **CI raises it and pushes to the default branch** — Rejected. `directCommits` fails it as "a change that did not go through a submission." That would mean rewriting the checks in a loosening direction, which requires human approval (the distributed "What to keep to")

## Unresolved

**No 0.1.0 tag is cut.** The 164 commits before this decision are all 0.1.0 and cannot be told apart. **Treated as something that cannot be attached retroactively.** For the same reason definition §6 says required attributes "cannot be attached retroactively," no meaningful assignment can be made after the fact.

**If two branches raise it at the same time, they get the same number.** This workspace limits agents to one (`CLAUDE.md`), so it does not happen now. When it does, it appears as a git conflict. **One side does not silently disappear.**
