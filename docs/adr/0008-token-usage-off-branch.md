# ADR 0008: Token consumption is not put on the branch but sent out over OTLP

- Status: Accepted
- Date: 2026-09-12
- Work item: AUT-162
- Related: [0002](0002-token-usage-capture.md) (partly superseded)

## Background

Token consumption records are written by the hook (Stop / SessionEnd). **The order is fixed.**

```
1. Commit
2. Submit
3. Report to the human and stop → the hook runs here and appends
```

**3 always comes after 1.** So the last record structurally never makes it into that work item's commit (AUT-156).

ADR 0002 closed this by having `begin` pick it up and commit it. **That was in exchange for two things.**

### Traded away 1: it mixes into another work item's submission

Picked-up records **ride on the submission of the next work item started.** Counting in the reference implementation, of 115 lines of token records, **93 lines (81%) went in with another work item's commit.**

Changes unrelated to the work mix into the submission, so readers need an explanation. **Needing an explanation means the shape is distorted.** Someone reading the submission's diff reads it as what that work item touched.

### Traded away 2: it is incompatible with parallel execution

Picking up is possible **only when the same working tree remains.** In a form that creates and discards a worktree per work item, there is no next `begin`, so the chance to pick up disappears entirely. **The higher the parallelism, the more is lost.**

A human pointed out (at the submission of AUT-156):

> Combined with a mechanism like Orca that creates working trees and works on several tickets in parallel,
> losses would keep piling up

## What changed

**In definition v0.16, token consumption was demoted from a required recording target to optional** (AUT-170). The ground was that when the outer loop was run once around, it had been used for a decision 0 times.

With this, **the reason to have a mechanism that compensates for what is missed disappeared.**

In addition, one premise ADR 0002 had placed also broke. ADR 0002 said "the place for records is not moved outside the history. Definition §16 decides where records go by lifetime, and telemetry is something that remains as a subject of aggregation." **That was a misreading.** What §16's recording conventions assign telemetry to is the Telemetry port, **not the Repo.** Being in the repository was merely a choice of adapter.

## Decision

**Token consumption is not written to the repository. It is sent outside the working tree over OTLP over HTTP.**

```
Stop / SessionEnd hook
  → sum usage per model for responses after the previous cursor
  → read the work item ID from the work item marker
  → build an OTLP span and POST it to the configured destination
  → on success, update the cursor
```

### Why OTLP: so as not to write in terms of a destination's name

What the adapter speaks is OTLP, not a particular service's API. **The destination and authentication are received from the configuration. Changing the destination does not change the adapter.**

OTLP is also what definition §16 gives as an example implementation of Telemetry.

**Langfuse was chosen as the receiving side** (human decision, 2026-09-12). Two things decided it.

- **There is a managed free tier.** The comparison, Arize Phoenix, is self-hosted, and its managed offering is a separate (paid) product. Our platform is Cloudflare Workers, which Phoenix does not run on, so placing it would mean adding one more VM
- **Cost comes out.** ADR 0002 said "the session record has no cost, so it is not stored but computed when read." The receiving side computes cost from the model name and token counts, so **the work of computing disappears entirely**

The Japan endpoint (`jp.cloud.langfuse.com`) is chosen.

**There are two ingestion endpoints, and the newer one is used.** `POST /api/public/ingestion` is deprecated, and Cloud stops accepting traces and observations from 2026-11-16. What is used is `POST /api/public/otel/v1/traces`.

### No SDK

OTLP over HTTP/JSON can be sent with a plain POST. Adding the OpenTelemetry SDK adds dependencies and background sending, but **the hook is a short-lived process that always exits 0, which does not mesh with a mechanism that batches and sends later.**

### Only numbers are sent

**Conversation contents are not sent.** Limited to the model name, token counts, work item ID, and session identifier. The receiving side can accept input and output bodies too, but there is no reason to send them out.

### A configuration with no destination is not treated as broken

Token consumption is an optional recording target (definition §6 v0.16). **If not configured, it is not recorded.** It does not stay silent; it states the reason. The invariant "Telemetry is recorded" does not fail on the presence or absence of tokens.

### The model identifier is not stopped here

**Regardless of whether there is a destination, the session state is always written.** The `model` that the other five §6 records carry comes from this path. **The model identifier remains a required attribute** (definition §6, supplementary notes to §16), and stopping them as a bundle would drop even what is required.

The definition side also untied the text that had bundled token consumption and the model identifier (v0.16).

### What could not be sent is not thrown away

If sending fails, the cursor is not advanced. The next time it runs, they are resent together.

**But if no destination is configured, it is advanced.** Having chosen not to record, there is no one to accumulate and send to later. Not advancing would attach the whole past amount to whatever work item is current when it is configured later.

### Stop picking up; make it noticeable

`begin` **only says that records were left behind. It does not commit them.**

With token consumption sent out, what is written to `telemetry/` is limited to **the AI working in that work item itself.** What it wrote itself, it can commit itself. **There is no one to pick up after.**

Still, some may remain, so it only says that they exist. **Picking them up and hiding them makes it impossible even to notice they got mixed in.**

## Measurement (AUT-174)

It was actually sent and read back on the receiving side.

| What was looked at | Value |
|---|---|
| Type | `GENERATION` |
| Model | `claude-opus-5` (it was in the receiving side's price table) |
| Cost | **$4.60** (cache creation and reads computed at separate prices) |
| Attributes | `work_item_id` / `kit_version` / `repo` are attached |

**ADR 0002's "cost is not stored but computed when read" is unnecessary on this path.**

### One thing got stuck in the setup

The value of `AUTODRIVE_OTLP_HEADERS` contains a space (between `Basic` and the base64). **Unless it is quoted in `.env`, it is cut off when the shell reads it.** Cut off, it passes silently and only authentication fails with 401, so the key gets suspected.

This was written in the credentials' description.

## Consequences

- **Records unrelated to the work item no longer mix into submissions.** One source of misreading is gone
- **Compatible with parallel execution.** Even if the working tree is discarded, the records have already gone out
- One more destination was added. But **a configuration without it also works**, so no required premise is added for where `/init` is run
- Cost comes out on the receiving side. ADR 0002's "compute when read" became unnecessary on this path
- **Past records were not moved.** Existing token records in the repositories remain as they are. Moving them retroactively would make it unreadable what was being recorded when
