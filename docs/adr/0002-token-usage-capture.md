# ADR 0002: Token consumption is read from the session record, triggered by a hook

- Status: Accepted (**where it is written and how cost is handled are superseded by [0008](0008-token-usage-off-branch.md), and the means of linking by [0009](0009-attribute-by-branch.md)**)
- Date: 2026-08-22
- Work item: AUT-10

## Background

Definition §6 makes token consumption a recording target, and the supplementary notes to §16 say "token consumption and the model identifier are attached automatically by the adapter, not by calls from skills. They are records that come from the runtime and do not appear in the vocabulary." BOOTSTRAP foretells this as the most laborious item in stage 1.

Stops and rework can be written by the AI itself, but token amounts have to be picked up from the runtime.

## Paths investigated

### Hooks (a trigger, but they carry no values)

**Hooks receive neither token amounts nor cost.** Even the model name is passed only as an optional field on `SessionStart`.

However, **every hook receives `transcript_path` and `session_id`.** So hooks are used as the trigger that decides "when to aggregate," and the values are read from elsewhere.

### The session record (where the values come from)

`~/.claude/projects/<project>/<session ID>.jsonl`. An append-only JSONL written by the runtime, with `usage` (`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`) and `model` per response.

Confirmed by measurement (594 lines, usage for 208 responses).

Two things cannot be taken.

- **Cost is not included.** There is no field resembling `cost`
- **`gitBranch` is `HEAD` on every line.** It seems to be recorded only once at session start; it does not change, while `cwd` changes correctly per line. **The idea of looking up the work item ID from the branch name does not hold**

> **Addendum 2026-09-12 (AUT-172)**: **This observation no longer applies.** The runtime changed, and `gitBranch` now holds the actual branch per line (confirmed over 800+ lines in one session). The observation at the time was not wrong; the premise moved. **A decision whose grounds are gone should be reread, grounds and all.** Note, however, that what [0009](0009-attribute-by-branch.md) adopted is not the session record but the working tree itself at the time of writing. It does not depend on the runtime's circumstances.

### OpenTelemetry (the long-term destination; not adopted now)

The runtime has OTEL built in, emitting `claude_code.token.usage` and `claude_code.cost.usage` (USD). It is exactly the path definition §16 gives as an example implementation of Telemetry, and **cost can be taken directly.**

But it is not adopted in stage 1.

- **There is no file output.** The exporters are only `otlp` / `prometheus` / `console` / `none`. Getting it into a file needs a resident collector or redirecting standard output. Neither fits definition §9's "built in as the default behavior of the harness." If a human forgets to start it, records disappear
- **It is not linked to work items.** Attributes go only as far as `session.id`; there is no work item ID. A mapping would be needed somewhere anyway

None of the migration conditions listed in BOOTSTRAP's "pending decisions" are currently met.

## Decision

**Use the hook as the trigger, the session record as the source, and the work item marker for linking.**

```
Stop / SessionEnd hook
  → receive transcript_path and session_id
  → sum usage per model for responses after the previous cursor
  → read the work item ID and target repository from the work item marker
  → append to <target repository>/telemetry/<work item ID>.jsonl with emitter: adapter
  → update the cursor
```

### Linking is done with an explicit marker

`.autodrive/current-work-item.json` holds the work item ID and target repository. It is working state, not a deliverable, so it is not put in the repository.

Getting it from the branch name is not possible because `gitBranch` cannot be used. Assigning by time range breaks when work items interleave.

### Without a marker, records are not thrown away

If the work item cannot be resolved, `null` is written to `work_item_id` and it is kept in `telemetry/unattributed.jsonl`.

**Not throwing records away is the point.** Erasing them from the records erases what was spent itself. Kept, they can be read later.

> **Addendum 2026-08-24 (AUT-49 / AUT-51, definition v0.10)**: This originally said "work not linked to a work item is work started without filing, a violation of CLAUDE.md." **That was wrong.** Deliberating whether to raise a work item, or requests before filing, belong to no work item. Definition §6 (v0.10) sorts these out as not being §6 events.
>
> Treating them as violations made correctly working records appear as `invariants` failures, and since `work_item_id` cannot be attached retroactively, it became a state that could not be resolved. Now, only for records in `unattributed.jsonl` that have a reason, `work_item_id` is not required, and the count and reasons are printed as observations. In addition, the reasons for not resolving (no marker / unreadable / contents missing) are distinguished and recorded.

With this, `invariants`' judgment of required attributes was changed from the existence of the attribute to **the validity of the value.** Checking existence alone lets `null` through.

### Cost is not stored but computed when read

Since the session record has no cost, storing it would mean multiplying by a price table. Stored, past values become wrong on every price change, and without anyone knowing they are wrong.

Only the token amounts (mechanically accurate) are recorded, and cost is computed when needed. Fixing the price table fixes past aggregates too.

### The port vocabulary does not change

As the supplementary notes to definition §16 say, these are records that come from the runtime and do not appear in the vocabulary. Skills do not call them.

### The hook is registered on the project side

It is registered in the repository's `.claude/settings.json`, not `~/.claude/settings.json`.

1. **`invariants` can read it.** Being in the repository, removal of the hook can be detected. This follows BOOTSTRAP's policy of "substituting by detection rather than enforcement"
2. No per-user environment setup is needed. Cloning distributes it

Right after cloning, the hook does not run until the workspace trust confirmation is passed. This state cannot be read from the repository, but no `emitter: adapter` events appear, so the invariant "Telemetry is recorded" does not rise to active as a result. **Whether it is registered and whether it actually runs can be covered by separate observations.**

## Consequences

- It depends on the session record being append-only. The cursor is held as a line count, with `last_uuid` alongside so its soundness can be checked
- A recording failure does not stop the agent. The hook always exits 0. That recording dropped is detected by usage events not appearing
- "Cost can be taken directly" is added to the motives for moving to OTLP. It is appended to BOOTSTRAP's pending decisions
