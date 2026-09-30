# ADR 0005: The setup is kept in the project, split into three commands by how it is decided

- Status: Accepted
- Date: 2026-08-27
- Work item: AUT-81

## Background

`init` placed the same things without asking anything. **What the project runs on was recorded nowhere.**

Not being recorded causes three problems.

1. **Replacement cannot reproduce the judgments made when placing.** It can only place the same things again every time
2. **It cannot be applied later to an existing project.** It would stride into a place where something is already running, by overwriting
3. **The AI decides what the project has by guessing.** When "having them decide how it looks," it started writing without confirming whether a preview URL could be produced

## Decision

The setup is kept in `autodrive.json`. **It belongs to the project and is not overwritten on replacement.**

The commands are split into three. **They differ only in how the setup is decided; the placing steps are the same.**

| | Precondition | How the setup is decided |
|---|---|---|
| `init` | No setup yet | **Ask the human** |
| `apply` | No setup yet, but there is content | **Look and infer; the human confirms** |
| `update` | A setup already exists | **Do not ask.** Re-place with what was recorded |

If a precondition is broken, it stops without placing and **says which one to run.** The human is not made to remember the differences among the three.

### How to ask

- **Do not ask what has only one option.** Do not spend the human's time on questions with no answer. Record it anyway
- **Do not ask in jargon.** Not "Preview port?" but "Do you want a place to see the running app on every submission?"
- **Show a recommendation, but do not decide.** Enter as-is takes the recommendation. Choosing by number takes the chosen one
- **Do not swallow an unreadable answer as the recommendation.** Someone who thinks they chose would not notice it was not chosen
- **When it cannot ask (no terminal, CI), proceed with the recommendation and say so.** Silently falling back to defaults makes undecided things look decided

### Whether there is a UI is not asked

`app.screen` is not decided by `init` and is placed as `unknown`. **It is decided at the stage of asking what to build** (item 1 of AUT-80), and at the time the foundation is placed, nobody knows yet. The AI adds it when it has heard.

## What we accept

**As of today, only two ports have two or more options** (Preview, Sandbox). The hearing is thin.

The setup is kept anyway **to create a place for it.** When a second implementation comes in, or kinds of app or agent increase, this is where the decisions go (ADR 0004).

**No abstraction now; only recording.** Templates are not split per kind either. Splitting with no reason to split doubles the same content, and eventually the two disagree.

## Why this shape

**The hearing was made a port.** Writing directly to the terminal would make the tests require a terminal. What cannot be checked eventually stops being checked. Tests inject answers, and **even look at what was asked.**

**Inference and settlement were separated.** What `apply` can see is "what is placed," and **not what is intended to be used.** Inferences are shown as recommendations, and the human decides (definition §10). The grounds (what it looked at to say so) are shown too.

**Do not show defaults as recommendations for what could not be inferred.** Configuration defaults are "initial values for ports that are not asked," not recommendations. Mixing them makes it fall back to defaults even while asking. This actually happened once.

## Rejected options

- **Keep only `init` and treat existing projects the same** — Rejected. It would overwrite what exists without looking at it
- **Make `apply` into `init --force` instead** — Rejected. It is not a difference of option but of how the setup is decided. Giving them the same name hides from the caller which one will happen
- **Keep the setup in the code (next to `VERSION`)** — Rejected. The reference implementation cannot hold what differs per project
- **Place the setup inside `autodrive/` too** — Rejected. That place is thrown away whole on replacement. What was decided would disappear
- **Have `update` reread the setup and write it back** — Rejected. Formatting differences and **the loss of items this version does not know about could creep in.** Only read it
- **Ask in free text** — Rejected. The receiving side would have to interpret the meaning, and what was chosen could not be read from the record
