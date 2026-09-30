# ADR 0003: Whether something is active is judged on records from a movable activation boundary onward

- Status: Accepted
- Date: 2026-08-22
- Work item: AUT-12

## Background

The judgment of the invariant "Telemetry is recorded" says "if there is even one `emitter: manual`, it is not active." Records written by hand in the bootstrap phase remain, so judging the whole period means **it can never reach active.**

The first idea considered was to place the time the adapter was introduced as the activation boundary, just once. But a human pointed something out.

> What happens if a failure occurs and we can no longer proceed without adding manual records again?

This can actually happen.

| Case | Example |
|---|---|
| A defect in the adapter | A bug in the reference implementation |
| A change in the runtime | The format of the session record or the hook specification changes |
| The Tracker is down | Work items cannot be looked up, so linking fails |
| Trust is reset | Re-cloning, moving to another machine |
| A record not in the vocabulary appears | This actually happens (the breakdown of rework causes; already sent back to the definition) |

With an activation boundary that moves only once, falling back to direct writes even once means never recovering. The wall just moves.

## What was already handled correctly

**Active falling when things fall back to direct writes is correct behavior.** The harness is back to not recording by default, so reporting it as not active is the fact. It is the same shape as definition §8's "loosening and tightening back are always operated as a pair": this is tightening back.

At that point `invariants` demands a substitution record. Without one it fails, so **the path of falling back to direct writes without leaving a record is already closed.** Definition §9's "the fact of substitution is left in the records" is doing its job.

What was missing was only the path to recover.

## Decision

**Whether something is active is judged on events from the last recorded activation boundary onward. The activation boundary can only be advanced through the adapter.**

- Falling back to direct writes → `manual` appears after the activation boundary, and active falls. A substitution record is needed
- The adapter is fixed → advance the activation boundary → back to active
- **Advancing the activation boundary needs a working adapter.** The boundary record itself is written through the adapter, so it cannot advance while broken

Advance it with `invariants --enact <invariant>`. It is refused if the hook is not registered in `.claude/settings.json`. Advancing only the boundary record without registration would claim active with no guarantee that recording continues.

### Splitting what is judged

| What is looked at | Target | Reason |
|---|---|---|
| Validity of required attributes | **The whole period** | They cannot be attached retroactively. Being before the activation boundary is no reason for them to be missing |
| Whether the write path is automatic | From the activation boundary onward | The question is "how is it now" |
| Substitution records | The whole period | Substitutions written before the activation boundary also count |

**Records before the activation boundary are not deleted.** They are only excluded from judging, and remain as history.

## Timestamps are parsed before comparing

ISO notation has several ways of writing offsets, and lexicographic order does not match real time. `2026-08-22T10:00:00+09:00` (=01:00Z) comes after `2026-08-22T05:00:00Z` lexicographically, but before it in real time. **Do not compare them as strings.**

Records whose timestamps cannot be read are kept in the judgment. Leaning toward excluding them would create a path to put records outside the judgment by breaking their timestamps.

### The activation boundary is placed at "now"

Records written by hand in the bootstrap phase contained values pointing to the future beyond real time (they were built from the date in the conversation, not read from a clock).

The idea of placing the activation boundary at `max(the latest timestamp among existing records, now)` was adopted once, but **that was wrong.** With the boundary placed in the future, every record written until then, correct ones included, falls outside the judgment. A 5-hour blind spot actually occurred. The time a record is written and the time the judgment runs are separate, so this hole is always stepped in.

Correcting the wrong values is right. **Commit times are used as the ground for correction.** They are verifiable values held by an independent system, and the time a record was written cannot exceed them. Corrected records keep the original value in `ts_corrected_from`, so what was fixed and how can be read from the records.

This is not rewriting to make things add up, but **correcting a wrong value.** The condition for keeping this distinction is that the fact of the correction and the original value remain in the records.

## The remaining hole

**By repeating direct writes → advance the boundary → direct writes → advance the boundary, active can be kept formally.** This cannot be closed.

However, **the number of times the activation boundary was advanced remains in the records, and `invariants` prints it.** Moving many times is itself a signal that the harness is not stable, and an input the outer loop should read in stage 4.

Not preventing it but making it visible. The same shape as the policy BOOTSTRAP decided: "that the AI cannot disable them is substituted by detection."

**How many times counts as abnormal is not set.** For the same reason definition §18 leaves the loosening threshold undecided: placing a number without real data leaves it without grounds. It only prints the count, and leaves the judgment to the human.

## Premise

**Humans do not operate the project's files directly.** Humans act only when the AI asks for a decision. So it is always the AI that calls the vocabulary, and `emitter: manual` means only "the adapter could not be reached." This judgment does not assume a human deliberately going around it.
