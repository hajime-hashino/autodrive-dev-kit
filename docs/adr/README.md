# ADR index

Records of design decisions that remain throughout the reference implementation. **Refer to this at the start of planning.** Placing it alone does not get it read (definition §16).

If you want to overturn a decision, read the relevant ADR before proposing. Proposing an alternative without reading the grounds repeats the same discussion.

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-implementation-language.md) | The reference implementation runs on Node, with types written in JSDoc. It has no dependencies | Accepted | 2026-08-21 (revised 2026-08-29) |
| [0002](0002-token-usage-capture.md) | Token consumption is read from the session record, triggered by a hook. Cost is computed, not stored | **Partly superseded by 0008 and 0009** | 2026-08-22 |
| [0003](0003-enactment-boundary.md) | Whether something is active is judged on records from a movable activation boundary onward. The activation boundary can only be advanced through the adapter | Accepted | 2026-08-22 |
| [0004](0004-vendored-kit.md) | autodrive-dev-kit is copied into the project and pinned by version. Updates to the reference implementation do not arrive automatically | **Where the copy is placed is superseded by 0010** | 2026-08-27 |
| [0005](0005-project-config.md) | The setup is kept in the project, split into three commands by how it is decided (`init` / `apply` / `update`) | Accepted | 2026-08-27 |
| [0006](0006-version-bump-policy.md) | The version is raised on every submission, and CI cuts the tag after integration | Accepted | 2026-09-08 |
| [0007](0007-ride-existing-integrations.md) | Ride the automation the port implementations already have. Build only what does not ride on it | Accepted | 2026-09-09 |
| [0008](0008-token-usage-off-branch.md) | Token consumption is not put on the branch but sent out over OTLP. Leftovers are not picked up; their existence is reported | Accepted | 2026-09-12 |
| [0009](0009-attribute-by-branch.md) | Records are linked to work items by the branch of the repository you are currently in. The marker is kept as a fallback | Accepted | 2026-09-12 |
| [0010](0010-distribution-boundary-in-the-tree.md) | The distribution boundary is expressed by directory hierarchy, not a list. `src/vendored/` is copied; `src/templates/` is distributed but not copied | Accepted | 2026-09-18 |
| [0011](0011-applying-an-app-standard-to-a-tool.md) | How far to apply a development standard for apps to a tool. What it demands of where it is put is not aligned; how it itself is developed is aligned | Accepted | 2026-09-21 |
| [0012](0012-sandbox-is-declared-not-built.md) | The sandbox is something the project declares. The reference implementation knows the contents only of devcontainer, and its checks are limited to that | Accepted | 2026-09-23 |
| [0013](0013-work-item-id-and-state-on-github-issues.md) | How work item IDs and state are held on GitHub Issues. IDs carry a prefix; state is distinguished by labels while open | Accepted | 2026-09-23 |

## How to write

- **File names in English, numbered.** `NNNN-kebab-case-in-english.md`
- **Contents in English.** The definition and this reference implementation are written in English
- When adding a new ADR, add one line to this index

**0001 to 0013 were originally written in Japanese and translated in AUT-265.** The meaning was not changed. The original text remains in the git history.

File names are in English because it keeps URLs, paths, grep, and tools straightforward. A file name is an identifier, not something to read.

### Do not quote people's words verbatim

**Write what the problem was, not what was said.**

It is tempting to put someone's words in the background, but **words carry how they were said at the moment.** What a later reader needs is the substance of what was raised, not the phrasing.

```
Do not write: > kitをここに寄せるか１回考えておきたいです
Write:        **A human raised "I want to think once about whether to align with the development standard"**
```

**Numbers and facts may be quoted.** Like "of 34 started, 30 were already integrated," **keep what serves as grounds.** Rounding weakens the grounds.

**Past ADRs are not rewritten for this.** They are records of decisions, and rewriting them later makes it unreadable what was decided at the time. **Apply it to what is written from now on.**
