# ADR 0001: The reference implementation runs on Node, with types written in JSDoc

- Status: Accepted
- Date: 2026-08-21 (revised 2026-08-29, AUT-97)
- Work items: AUT-6, AUT-97

> **Revision of 2026-08-29 (AUT-97).** It originally ran TypeScript type annotations directly. **Since that turned out not to be distributable with `npx`, it was changed to plain JS with types written in JSDoc.** See "Revision" at the end for the background. The decisions on Node and zero dependencies were not changed.

## Background

The stage 0 deliverable `invariants` was first implemented in Python. A human questioned the style of an extensionless file with a shebang, suggested that TypeScript or Bun might be better given that the harness would keep growing, and pointed out that Python might be weak against supply-chain attacks.

## Deliberation

### The supply-chain angle does not decide this

The premise of the point is reversed. npm sees more supply-chain attacks than PyPI, at a larger scale. There is a structural reason: the tree of transitive dependencies is an order of magnitude deeper. Moving from Python into the npm world raises the risk on this axis.

However, this axis does not bear on this decision. **The actual defense is keeping dependencies at zero, and that can be done in both.** As long as it is zero, which registry is more prone to attack does not matter.

So being able to keep zero dependencies is held as a constraint, and the language is chosen for other reasons.

### What decides it: the destination is TypeScript

- The subject app's Preview is Cloudflare Workers, which is TypeScript
- The agent hook that captures token consumption in stage 1 runs on Node
- Where `/init` distributes to in stage 5 is also expected to be TypeScript projects

With only the reference implementation in Python, adapters would be kept in two languages, or called through the shell.

As supporting material, the development machine's Python is 3.9 (the old one bundled with the OS), which would require managing version differences with CI. Node can run type annotations directly without a build step.

### Node rather than Bun

The reference implementation runs in the CI of every repository, and in stage 5 is distributed to other projects by `/init`. What it demands of the execution environment matters most, so Node, which is more likely to be installed, is adopted.

The code is written using only the `node:` standard modules. It runs as-is even if the subject app uses Bun.

### Do not leak the implementation language to callers

`invariants` remains an extensionless executable. This is the standard style for Unix CLIs (the development machine has 180 extensionless executables with shebangs in `/usr/bin` and `/opt/homebrew/bin`), and what users type is `invariants`, not `invariants.js`.

This shape means **swapping the language does not break CI invocations or each repository's settings.** This migration demonstrated that.

However, without an extension an editor cannot tell the language, so `invariants` is kept as a launcher script and the body is placed in `src/*.js`.

## Decision

- The execution environment is **Node**. **No build step**
- The implementation is **plain JS**. Types are written in **JSDoc**
- **No `dependencies`.** Tests use `node:test` and HTTP uses `fetch`, both built in
- **`devDependencies` may be placed, limited to means of checking** (revised 2026-09-21; below)
- `invariants` is an extensionless launcher script, and does not leak the implementation language to callers

## Consequences

The zero-dependency constraint is tested when `boundaries.yaml` is read in stage 3. Node has no built-in YAML parser. The options at that point are the following three, to be decided in stage 3.

1. Keep a small, self-built parser for only the needed parts
2. Add one dependency
3. Make the delegation table JSON

Since zero dependencies is the actual defense, 1 or 3 are considered first. If 2 is chosen, this ADR is updated.

## Revision (2026-09-21, AUT-226) — `devDependencies` only for means of checking

**What is distributed still has zero dependencies.** What changed is allowing development-time dependencies only for means of checking.

### Why it changed

**Types were written in JSDoc, but nobody was checking them.** This ADR decided "types are written in JSDoc," but **placed no means of checking whether the written types matched the implementation.**

When it was actually put in, **three places turned up where the written types were not taking effect.**

- `RepoApi` and `TrackerPort` **were types that did not exist where they were referenced**
- `checks.js` **wrote the names `TelemetryEvent` and `Scope` without importing them**
- **The Tracker implementation did not match the port's contract.** `state` was returned as `string` without being narrowed to the vocabulary

**Writing types only as documentation cannot tell you when the documentation is lying.**

### Relation to the original argument

The argument of this ADR is "**the tree of transitive dependencies is an order of magnitude deeper.**"

**On depth, it does not apply.** It was measured.

```
$ npm install typescript@7 @types/node@22
added 4 packages
$ ls node_modules
@types  @typescript  typescript  undici-types
```

On the registry, `typescript` has about 20 platform-specific binaries in the same scope, but **they are optional, and only the one matching the execution environment is actually installed.** The publishers are limited to two (Microsoft and Biome), and all are leaves.

**On count, it cannot be said not to apply.** Zero becoming four is a fact. **Do not write "almost none."**

### Scope

What may be placed is limited to the following.

| What | Treatment |
|---|---|
| **May be placed** | Means of checking (type checking, linters). **Limited to `devDependencies` only** |
| **Not placed** | `dependencies`. What is distributed stays at zero dependencies |
| **Not placed** | A test runner. `node:test` is enough. **There is no reason to replace it** |

**It does not reach where it is distributed.** `node_modules` is not in `files` of `package.json`.

### The lock file

**It is tracked.** `.gitignore` used to exclude it, but that was because "there are zero dependencies and nothing in it," not a decision not to commit it. **Adding dependencies while it is excluded leaves them unpinned and invisible in diffs.**

### Strictness

**It starts with implicit any allowed** (`noImplicitAny: false`).

Turning on all of `strict` produces 588 errors. 425 of them are "argument types are not written," and **fixing them all at once would turn this work into just writing type annotations.** The remaining 68 contained the real mismatches.

**What is allowed is written in `docs/quality.md`.** So that the range not looked at can be read.

**Tests are excluded.** Including them makes 575, of which 312 come from the test runner having no types. **Separate the steps.**

## Revision (2026-08-29, AUT-97)

### Why type annotations were dropped

**It cannot be distributed with `npx`.**

```
ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
Stripping types is currently unsupported for files under node_modules
```

**Node deliberately does not strip type annotations from files under `node_modules`.** Running type annotations directly stops working the moment it is installed with `npx`.

This was not an error in the original decision. **Distributing with `npx` was not anticipated** (at the time, it was assumed that whoever ran `/init` had cloned the reference implementation). A human suggested "wouldn't it be more convenient to make it usable with npx," and it became clear that the initial friction was falling on the very people least meant to be burdened (AUT-96).

### No verification was lost

**Type checking had never been done from the start.** Node only strips type annotations; it does not check them. `tsc` is not in this repository (because of zero dependencies). Tests are `node:test`.

**The type annotations were documentation, not verification.** Moving to JSDoc loses only the writing comfort.

### Rejected options

- **Build for distribution** — Rejected. Putting `typescript` in devDependencies would do it, but **what is distributed would become generated output.** ADR 0004 chose copying because "a copy can be read as it is," and that premise would break
- **Copy outside `node_modules` before running** — Rejected. **A mechanism for working around a constraint creates a new hole** (the distributed "Signs to stop and reconsider")
- **Give up on distributing with `npx` at all** — Rejected. The initial friction remains

### How it was migrated

**Types were stripped with Node's `stripTypeScriptTypes`, preserving positions.** Type annotations are replaced with whitespace, so indentation, line breaks, and comment placement do not change. Emitting with `tsc` would change the formatting and make the diff unreadable. **Only the stripped lines were touched.**

### The check this revision left behind

**Confirm that it runs inside `node_modules` as well** (`test/packaging.test.js`).

**A check that points at a local path does not go through this path.** npm symlinks local paths, so the real files remain outside `node_modules`. It was checked that way and reported as "it worked" (AUT-96). **It worked only because it happened to be a path that does not hit the constraint.**
