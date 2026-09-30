# Deciding how it looks, before building it

When building something with a UI, **agree on how it looks before starting implementation.**

## Why

How it looks is **the part people deal with the longest**, and fixing it later means rebuilding. Left alone, the AI decides it silently.

That actually happened. In one work item, the avatar options, the screen layout, and the wording **were all decided by the AI. The human could only see them after they were deployed.**

## This is not a review

**Get this wrong and the method breaks.**

Definition §14 says a gate "midway (approval of intermediate artifacts)" **does not hold.** Inserting a design document review makes the human the means of detection itself, and §1's replacement does not happen. §8 also excludes design documents from spot checks.

**How it looks is different.** Definition §10 makes "presenting the What/Why" a human role. **How it looks is part of the What**, not something to be inspected for correctness.

| | Positioning | Holds? |
|---|---|---|
| The AI makes a design document and **the human inspects it** | Approval of intermediate artifacts | **No** (§14) |
| The AI proposes options and **the human decides** | Decision at a stopping point | Yes (§10) |

**It is deciding, not inspecting.** Therefore:

- The human **does not have to draw anything.** They choose from the options shown, or say what they want changed
- The AI **does not ask for approval** with "Is this OK?" It **presents options**: "I did this; what would you like?"
- What was agreed **is recorded as the human's presentation.** The AI does not rewrite it on its own judgment

**Make it a form that works even for non-engineers.** If this breaks, the premise of this method (developing at a consistent quality regardless of the person's skill level) breaks.

## When to do it

**When a new way of looking comes into being.**

| Situation | Needed? |
|---|---|
| Building a new screen | **Yes** |
| A new element appears on a screen (options, status display, input fields) | **Yes** |
| Deciding the policy for wording | **Yes** |
| Items are added along an existing shape | No |
| There is no screen (`invariants`, recording machinery, CI) | **No** |

This is the same shape as definition §5 separating inner from outer by "whether it moves a cell in the delegation table." **Growth within the same shape is inner; the target is where a shape itself comes into being.**

**Do not stop every time.** The more you stop, the more human involvement grows, lowering §4 (output per unit of human involvement). When in doubt, judge by "could a human who looks at this feel something is off?"

## How to do it

**Show something that runs.** For the same reason definition §8 limits spot checks to "how the working product looks," documents and diagrams cannot judge width, color scheme, or how it looks on a real device.

In the reference implementation, **every submission produces a preview URL.** Each version gets a separate URL, and it does not affect production traffic. It may have no substance (a button that does nothing when pressed is fine).

### Previews appear on top of the verification environment

**It is not a separate environment.** It is an alias given to a version uploaded to the verification environment's worker.

```sh
wrangler versions upload --env staging --preview-alias "$ALIAS"
```

Get this wrong and **you end up looking at the verification environment while believing you are looking at "the preview."** It was actually reported that way (AUT-125). Not a violation; that is how it was built. **Where it runs was written nowhere.**

### Show previews and the verification environment while keeping them closed

**Do not publish just to check how it looks.** Follow "Exposure can be reverted but not undone" in `src/templates/autodrive-reference.md`. If checking needs publication, that itself is a point to put to the human.

With Cloudflare Workers, **you can keep it closed without preparing a custom domain.** Enabling Access per worker protects every destination tied to that worker at once (route, custom domain, `workers.dev`, **previews**).

- Viewing requires signing in with an allowed account
- **You can protect only the previews** (production can be treated separately)

**If you use WebSocket, use per-destination Access rather than per-worker.** The per-worker method fails connection upgrades with 403.

Reference: [Cloudflare Access (Workers)](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

1. The AI submits an implementation of only how it looks
2. **The human opens the preview URL**
3. The human decides. If something should change, they say so
4. Record what was agreed
5. Start implementing the substance

**Do not build the substance in step 1.** Building it increases what is thrown away when fixing, and "it's already built" creeps into the judgment.

## Recording

Keep two things.

**What was agreed** is kept in the same place and treated the same as the What/Why. It is the human's presentation, and the AI does not rewrite it on its own judgment.

**The fact of stopping** is kept as a stop event (definition §6). The kind is `design_agreement`.

```sh
telemetry 停止を記録する --kind design_agreement --type 入力 --detail "<what they were asked to decide>"
```

**This is an "input" stop.** Having them decide how it looks is evidence that the method is working correctly, not something to reduce (definition §6 v0.11). What to reduce is rebuilding after they decided.

**If stops of the same kind recur, they are candidates for skills and automation** (definition §6). For example, if options are presented the same way every time, that way can be made into a template.
