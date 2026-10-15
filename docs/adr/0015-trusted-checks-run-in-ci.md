# ADR 0015: The checks you can trust run in CI. By hand, they use the agent's key

- Status: Accepted
- Date: 2026-10-15
- Work item: ADK-144 (with ADK-143)

## Background

The checks (`invariants`) read the Repo with `AUTODRIVE_CI_TOKEN`, a key that can only read. It was kept separate from `GH_TOKEN`, the agent's key that can write, and placed in `.env` next to it (AUT-139). The reason given was that **the side that checks must not be able to rewrite what it checks**, since one of the things checked is "the AI cannot disable any of these" (definition §9).

An organization using this reference implementation banned personal access tokens (#143). Looking for where the read-only key was actually needed, **a human raised that the separation does not protect anything on the agent's side**: the agent can rewrite the code that judges, and it holds `GH_TOKEN` anyway.

That is correct. A read-only key in `.env` only guaranteed that the judging code reads with a read-only key. It did not stop the AI from disabling anything.

### Where the guarantee actually comes from

Definition §9 places fixed conditions in layers the AI cannot touch, and §12 says humans prepare those layers (the CI/CD platform, permissions). **A check can be trusted when it runs there**, from the default branch, with credentials the agent never sees.

Until now, the CI placed by `init` ran only `--scope self`, which needs no key. **The checks that need the Repo ran only by hand**, which is exactly the place they cannot be trusted.

## Decision

| Where | Key used | What it is |
|---|---|---|
| By hand | The agent's key (`GH_TOKEN`; `AUTODRIVE_TRACKER_TOKEN` for Issues if set) | A check during work. **Not a ground** |
| CI | A key that can only read (`AUTODRIVE_CI_TOKEN`, or a GitHub App token) | **The checks to trust** |

- `AUTODRIVE_CI_TOKEN` is no longer listed in `.env.example`. If it is set, it is still preferred
- The placed CI gains a `cross` job (ADK-143): pushes to `main`, daily, by hand. **Not on pull requests**: what it looks at is the state after integration, and a pull request would run code the AI wrote with the key attached
- **Without a key, `cross` fails** and says how to set one up. Not being able to judge is not passing

### Why the CI key stays read-only

Not for the reason in AUT-139. **A key in CI should be no stronger than the job needs.** The job only reads, so the key only reads. With a GitHub App, the token is made in the job asking only for read permissions.

## What this changes in earlier decisions

ADR 0013 says `AUTODRIVE_CI_TOKEN` "is not shared" because sharing it "would let the side that checks rewrite what it checks." **That reason no longer holds by hand.** ADR 0013 is left as written, as the record of what was decided then.

The name `AUTODRIVE_CI_TOKEN` now matches what it is: a key for CI.

## Remaining

- Making `GH_TOKEN` a GitHub App token, for organizations that ban personal access tokens, is on hold until results come back from a project trying it
- In a project just started, `cross` can be red even with a key: until the outer loop has gone around once or a substitution is recorded, the checks return 1
