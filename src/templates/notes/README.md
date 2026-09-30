# Your place

**A place to organize your thoughts before handing them to the AI.** Materials, scribbles, links you are halfway through reading.

**Its contents are not tracked** (they are in `.gitignore`). Only this README is tracked.

## Whose it is

**It is yours.** The AI reads it when asked, but **does not rewrite it on its own.**

When you want it read, just say so.

> Read the thoughts I put together in `notes/` before starting

## What must not be put here

**Production credentials.** Client secrets, signing keys, deployment tokens.

The distributed rules say:

> **Do not keep production credentials locally.** Only CI holds the deployment token

Putting values here **makes them readable by the AI**, and that premise breaks.

**`.gitignore` only prevents committing.** It cannot prevent what is put in the sandbox from being taken out. **Not being tracked and being protected are different things.**

## Where values go

| Target | Where |
|---|---|
| Credentials for the deployment target | Register them with the deployment service. If you keep a copy, a password manager |
| Credentials CI uses | The Repo's secrets |
| Credentials the AI uses | `.env` (`.env.example` lists them) |

**You may record here which credential is where, without writing the values.** It is not information that can be taken out, but something to refer to when unsure.
