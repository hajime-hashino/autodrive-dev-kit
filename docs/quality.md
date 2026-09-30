# Quality management

**This is the record of what this tool decided to check, by which method, and how far.**

The list of aspects and stages, the baseline, and how to decide are in `src/templates/autodrive.md` "Quality management."
**This is where the decided results go.**

## How this tool differs from others

**Its users are the projects that adopt this tool.** A broken tool affects everything it is put into.

**Nothing runs in production.** It runs where it is distributed. So what corresponds to "production monitoring" is
**judging the real workspace every day** (the scheduled run in `.github/workflows/invariants.yml`).

**It has zero dependencies** ([ADR 0001](adr/0001-implementation-language.md)). For dependency vulnerability scanning,
there is nothing to scan.

---

## What is checked

| Aspect | Stage | Method | How far it looks |
|---|---|---|---|
| Achieving the business purpose | Acceptance | `initEndToEnd.test.js`, `packaging.test.js` | **Placing it in a bare directory, up to the checks running.** Also checks that it runs from under `node_modules` (the npx path) |
| Functionality | Unit, integration | `node --test` (565 tests) | Checks, placement, records, starting work, sandbox, and the wording of what is distributed |
| Functionality | **The checking mechanism** | **Mutation testing** (84, `npm run mutate`) | **Whether tests fail against a broken implementation.** A passing test passes even if it looks at nothing |
| Security | Static | Zero dependencies (ADR 0001), `tracked.js` (built into the checks) | **For dependency vulnerability scanning, there is nothing to scan.** For leaked secrets, it looks at two things: when placed as files (names, ELF), and **when keys this tool actually uses are written as values.** Other "plausible strings" are not looked at by `tracked.js` (that is the job of off-the-shelf tools). **In this repository, those off-the-shelf tools are running.** GitHub's Push protection stops them at push time, and Secret Protection reports them including history |
| Reliability | Production monitoring | **The daily cross-repository check** (06:00 JST) | Looks at the real four repositories. Whether records, the scope of delegation, the submission path, and the recording machinery are alive |
| Maintainability | Static | **Type checking** (`npm run typecheck`) | **Implementation only.** Implicit any is allowed (425 places have no argument types). **Tests are excluded** (there are no types for the runner, producing 312 errors) |
| Performance | Local | **Time taken by mutation testing** (printed by `npm run mutate`) | **Only prints the total and per-mutation time.** No threshold. Locally 334 seconds / 3.6 seconds each (89, 2 logical cores). **Nothing has been done to make it faster** |

**Do not omit "how far."** The name of a method alone does not say whether it looks at everything or at a single path.
**Readers take it that ranges not written are being looked at too.**

## What was decided not to check

| What | Why it was left open | Condition for revisiting |
|---|---|---|
| Dependency vulnerability scanning | **What is distributed has zero dependencies** (ADR 0001). There are 4 development-time dependencies, from 2 publishers, all leaves | When even one `dependencies` entry is added |
| Argument types (implicit any) | There are 425 places. **Fixing them all at once becomes an exercise in writing type annotations.** The real mismatches were in the remaining 68 | Align them starting from newly written code |
| Type checking of tests | Of 575 errors, 312 come from **the test runner having no types.** **Mismatches in the implementation get buried** | Once the implementation side has settled |
| Monitoring behavior where it is distributed | Where it is distributed belongs to the project and cannot be seen from here. **Do not write that something is watched when it cannot be seen** | When there is a mechanism to collect records from where it is distributed |

## What cannot be undone

| What could happen | What detects it | Who triggers |
|---|---|---|
| Credentials leak | It stops if `.env`, key files, or core dumps are tracked. **It also stops if keys this tool uses (`ghp_`, `lin_api_`, `sk-ant-`, etc.) are written as values.** But **keys of unknown shapes are not caught** | — |
| A broken version is distributed | All tests and mutation tests on every submission. **Tags are cut by CI after integration** (ADR 0006) | Human (integration is the trigger) |
| Settings where it is distributed get broken | If managed files were changed by hand, it **writes nothing and stops** (`manifest.js`) | — |
| A change that loosens the checks gets in | **Only the convention that it requires human approval.** There is no mechanical detection | Human |

**If there is none, write "none."** A blank is read as "no problem."

**"None" and "decided not to check" are different.** "None" in the table above means
**decided to do but not built yet.** What was deliberately left unwatched is in
the section above.

## Levels decided

**It was the AI that proposed and the human that chose.** It must be readable who decided.

| Item | Level decided | When decided |
|---|---|---|
| Type checking | **Put in** (AUT-226). `tsc --noEmit`, implicit any allowed. ADR 0001 was revised to **allow development-time dependencies only for means of checking** | 2026-09-21 |
| Scanning for leaked secrets | **Put in narrowly** (AUT-225). Since `tracked.js` had already decided "not to search broadly for patterns," **it was limited to the prefixes of keys this tool actually uses.** Widening it would make an inferior copy of off-the-shelf tools, and false positives would wash out the real ones | 2026-09-23 |
| Performance | **Only print the time** (AUT-227). Running a narrowed subset is not adopted. **It would falsely report as "passed" mutations the full run would have caught, prompting unnecessary checks to be added and eroding trust** | 2026-09-23 |
| Dependency vulnerability scanning | **Not checked.** Zero dependencies; nothing to scan | 2026-09-21 |
| GitHub secret detection | **Enabled** (AUT-253). Available for free because it was made public. The AI proposed; the human enabled it. **Whether it is enabled is not looked at by the checks** (the agent's token has no permission to read it). **It is not necessarily available where the tool is distributed.** It cannot be used on private + Free, where only `tracked.js` remains | 2026-09-26 |
