# ADR 0011: How far to apply a development standard for apps to a tool

- Status: Accepted
- Date: 2026-09-21
- Work item: AUT-228

## Background

There is a development standard used in another effort (AI Development Standard). It pins the runtime with `mise`, uses Biome and strict `tsc --noEmit` for TypeScript, Bun or Vitest for tests, pins dependencies with a lock file, and so on, and is placed in `~/.claude/CLAUDE.md` to take effect across all projects.

**A human raised "I want to think once about whether to align with the development standard."**

AUT-214 decided "put in type checking," but **at the stage of choosing tools, it cannot be written unless it is decided whether to align with this standard.**

## Decision

**Align partially. Do not apply it wholesale.**

**The reason it cannot be applied is not preference but structure. The standard is written for apps, and autodrive-dev-kit is a tool.**

| What the standard assumes | For a tool |
|---|---|
| You can decide the execution environment yourself | **You cannot.** It goes into other people's projects via `npx` |
| Only you run it | **It runs everywhere it is put** |
| Pinning dependencies with a lock file is enough | **It rides on the dependency tree of where it is put** |

### What is aligned

| What | Why |
|---|---|
| **Type checking** (strict `tsc --noEmit`) | Types are written in JSDoc, but nobody checks them |
| **A linter** (Biome) | There is none |
| **Track the lock file** | If dependencies are added, they need pinning (below) |
| **Pin direct dependencies exactly, and check their name, source, owner, and necessity** | Does not contradict ADR 0001's zero dependencies. **Zero is the extreme of "minimize"** |
| **Do not pipe remote scripts into the shell** | Already followed (no occurrences; confirmed) |

### What is not aligned

| What | Why |
|---|---|
| **Carrying runtime pinning into requirements** | **`engines` must be a lower bound** (currently `>=22.18`). A specific version cannot be forced on where it is put. **Pinning the development environment and CI is a separate matter, and fine** |
| **Bun** | Distributed via `npx` (Node). The standard itself provides an escape hatch, "pnpm when Node.js is needed," so there is no conflict |
| **Vitest** | It runs on `node --test`. **There is no reason to switch at the cost of breaking zero dependencies.** The standard does not anticipate the option of zero dependencies |
| **Python** | No reason to use it. [ADR 0001](0001-implementation-language.md) explicitly rejects it |

## The number of dependencies was checked

**It was assumed that "there are almost no transitive dependencies," but that was wrong** (based on old knowledge). The result of checking the real thing is as follows.

| | Actual (checked 2026-09-21) |
|---|---|
| `typescript` 7.0.2 | **About 20 platform-specific binaries** in the same scope `@typescript/*` (optional). It has gone native |
| `@biomejs/biome` 2.5.14 | **8 platform-specific binaries** in the same scope `@biomejs/cli-*` (optional) |

**The right way to put it is "the tree is shallow," not "almost none."** Depth 1, same scope, same publisher, optional, and only the one matching the execution environment is actually installed. **But about 28 in total come from the registry.**

The argument of ADR 0001 is "**the tree of transitive dependencies is an order of magnitude deeper.**" **On depth, it does not apply. On count, it cannot be said not to apply.** When updating ADR 0001 (AUT-226), keep this distinction.

**It does not reach where it is distributed.** They are development-time-only dependencies, and `node_modules` is not in `files` of `package.json`.

## The lock file

`.gitignore` excludes `package-lock.json`.

```
# The policy is to have no dependencies, but exclude it in case npm creates one.
```

**It is not a decision "not to commit."** With zero dependencies there are no contents, and it simply does not track the empty one `npm install` happens to create (AUT-6, since stage 0).

**The moment dependencies are added, this exclusion becomes harmful.** Contents appear but are not pinned, and **being excluded, they do not show in diffs either, so nobody notices.** Remove it in AUT-226.

## What this decision produces

**The next time the same question comes up, it need not be thought through from scratch.** The axis of judgment is separating "**what it demands of where it is put**" from "**how it itself is developed.**" The former cannot be aligned. The latter may be.

**Even if the standard is updated, this line does not change.** What changes is only the specifics on the aligning side.

## Rejected options

- **Align wholesale** — Rejected. Pinning `engines` would make it a tool that chooses where it can be put. **It would no longer be something distributed**
- **Do not align** — Rejected. The state of no type checking and no linter continues. **There is no reason to choose different tools when a standard already exists**
- **Ask for the standard to be changed into a form usable for tools** — Rejected. That applies to all of one person's projects, and **is not something to bend for the convenience of one tool.** The side applying it draws the line
