# ADR 0010: The distribution boundary is expressed by directory hierarchy, not a list

- Status: Accepted
- Date: 2026-09-18
- Work item: AUT-202

## Background

[ADR 0004](0004-vendored-kit.md) decided what to copy by a list of names (`src` / `hooks` / `bin` / `invariants` / `VERSION` / `package.json`). **That list sat at the same level as the reference implementation's top directory.**

```
autodrive-dev-kit/
  bin/ src/ hooks/ templates/ invariants verify   ← distributed
  test/ docs/ mutations/ telemetry/ README.md     ← not distributed
```

Looking at it, you cannot tell which is which. A human pointed out:

> Things that are distributed and things that are not are mixed at the same level, which felt hard to follow

Furthermore, there were three lists of what is distributed.

| List | What it decides | How it was maintained |
|---|---|---|
| `files` in `package.json` | What npm distributes | **By hand** |
| `VENDORED` in `init.js` | What is copied into the project | By hand |
| `DISTRIBUTED` in `releaseVersion.js` | What triggers a version bump | Derived from `VENDORED` |

Only the third was derived. This was intentional, from the experience in AUT-160 of an index maintained by hand going stale.

**The first was outside the derivation.** And `vendor()` silently skipped anything without a source. So if something was added to `VENDORED` and not to `files`, **a copy with missing contents would be made only via npx, and no check would fail.** It was not actually broken, but there was no mechanism to notice if it broke.

## Decision

**Bring the distribution boundary out into the hierarchy.**

```
autodrive-dev-kit/
  src/
    vendored/     copied. its contents become autodrive/ as they are
      invariants        shell
      hooks/            shell
      bin/              shell
      internal/         implementation. not called by name
    templates/    distributed, but not copied
  VERSION LICENSE NOTICE package.json   accompaniments. copied
  test/ docs/ mutations/ telemetry/ README*   not distributed
```

- **The contents of `src/vendored/` are expanded directly under `autodrive/` without a name of their own.** So the relative path from shell to implementation is the same in the reference implementation and in the copy
- **`templates/` is placed outside `src/vendored/`.** The npm boundary and the copy boundary are different. Putting it inside would need an exclusion list "exclude templates from the copy," and the list that was removed would come back in another form
- **The accompaniments stay at the top of the repository.** Both npm and Apache-2.0 assume they are there, and `package.json` in particular cannot be moved
- **Anything without a source is not skipped.** Stopping there is better than running with pieces missing
- **Disagreements between the lists fail before running** (`test/packaging.test.js`)
- **The old name `verify` is removed.** The path changes anyway, so compatibility is lost. Keeping it would make a meaningless thing: an old name in a new place

## Why

**A shape where you cannot forget to add something is stronger than creating a chance to notice forgetting.** The same judgment as making `begin` the entrance. Put it in `src/vendored/` and it is distributed; put it outside and it is not. No need to remember the list.

The lists do not disappear completely because the accompaniments and `templates/` are outside the hierarchy. **That part cannot be derived, so a check that compares them was placed.**

## What this decision produces

**One difference of location remains in how `kit_version` is read.** The accompaniments are at the top of the repository in the reference implementation and at the top of the copy in the copy. `kitVersion.js` looks at both. **That disagreement is confined to that one place.**

**The judgment that `update` cannot be run from the copy rests on the absence of templates.** This property comes from ADR 0004 and does not change. In the reference implementation, it looks at `<repository>/src/templates`.

**Existing copies stay old until `update` is run.** An intended property (ADR 0004), but this time the shape of the copy's contents changes, so old and new do not mix until it is run.

## Rejected options

- **Put `templates/` into `src/vendored/` too** — Rejected. A list excluding it from the copy would be needed. The list that should have been removed comes back
- **Put the accompaniments into `src/vendored/` as well** — Rejected. `package.json` cannot be moved, and placing `LICENSE` at `autodrive/src/LICENSE` is not straightforward in light of the intent of Apache-2.0 §4(a)
- **Keep the hierarchy and only add a comparison between the lists** — Rejected. Disagreements could be caught, but it still could not be understood by looking. **And every time something is "added to what is distributed," the effort of writing it in two places remains**
- **Keep `verify` as `src/vendored/verify` instead** — Rejected. Callers' paths change anyway, so it would not be compatible
