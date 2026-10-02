# autodrive-dev-kit

**A toolkit that lets you build software with AI, without needing to be an engineer yourself.**

Reference implementation of [AI Autodriving Development](https://github.com/hajime-hashino/autodrive-dev-definition).

*日本語版は [README.ja.md](README.ja.md) にあります。*

## What this is for

**Making the quality of what you ship independent of how experienced you are.**

Speed is not the point. **Anyone can go fast by letting an AI write the code.** The question is who checks that what came out is correct. Normally that job rests on an experienced human. **Without that experience, speed simply becomes risk.**

This method moves that job from experience into machinery.

| Principle | What it means |
|---|---|
| **The AI leads** | It sets up the environment, starts the work, records what happened, and runs the checks. You decide what to build, how it should look, and in what order |
| **No prior knowledge assumed** | Questions and explanations are in your language, not in implementation jargon. **An explanation you cannot read is an explanation you cannot verify** |
| **Delegation is measured, not declared** | How much to delegate is decided from recorded evidence, not from assertion. Areas that are not working are pulled back |

The third one is the centre of this method. **It never claims "the AI can be trusted with this."** It records how each delegated area actually behaved, and widens the boundary only on measured evidence.

## How it works

Three things keep the work delegable.

| Element | What it means |
|---|---|
| **Invariants** | No change reaches the default branch without going through a submission. Production credentials never sit on your machine |
| **Telemetry** | Stops, rework, missed detections, delegation changes, and token spend are recorded automatically |
| **Checks** | A checker decides mechanically whether the two above are actually working. Measured, not declared |

The records exist to improve the machinery itself.

## Where it stands

**This is still being grown.** It is not published yet, and two projects are being built with it.

**The kit builds itself with its own method.** Every change to the reference implementation goes through the same path described here, from filing a work item to submission and integration. **A rule its own author does not follow is not a rule.**

Three of the four invariants are active; one is currently substituted by hand, and the checker reports that state. See [docs/invariants.md](docs/invariants.md).

## Requirements

| Component | Used for | Required |
|---|---|---|
| Node 22.18 or newer | Running the toolkit | Yes |
| Linear | Filing work items, tracking status, linking records | Yes |
| GitHub | Integration through submissions. The checker reads this | Yes |
| Cloudflare Workers | Previewing how a screen actually looks | If it has a UI |

## Usage

### Getting started

Run this inside the project you want to adopt it in.

```sh
cd <your project>
npx github:hajime-hashino/autodrive-dev-kit init
```

**No clone, no PATH setup.** Node 22.18 or newer is all you need.

That command is long to type, so you may put it on your PATH instead.

```sh
export PATH="$PATH:<where you keep this reference implementation>/bin"
autodrive-dev-kit init
```

It asks about your setup. **The first question is your language** (日本語 / English). English is the default. Each question shows its options and a recommendation, so type a number or just press Enter. Answers are saved to `autodrive.json` and you are not asked again.

**Answers can also be given as arguments**, for when there is no terminal to ask on (for example, when an agent runs it for you). What is not given is asked as usual.

```sh
autodrive-dev-kit init --language en --tracker linear --preview cloudflare-workers --sandbox devcontainer
```

`--prefix` sets the work item ID prefix, which is asked only for GitHub Issues. A value that is not one of the options stops it without placing anything.

**That language setting only affects setup.** During development the AI speaks whatever language you speak.

| Command | Used for |
|---|---|
| `init` | Adopt in a new project. Asks about the setup, then places files |
| `apply` | Adopt in an existing project. Infers the setup from what is already there and asks you to confirm |

**That is everything you type.** At the point you run these, there is no project yet and no AI in it.

Copy the placed `.env.example` to `.env` and fill in your credentials. That is the end of the manual work.

### Updating autodrive-dev-kit

To move an adopted toolkit to a newer version, ask the AI:

> I want to update autodrive-dev-kit

The AI files the work item, updates, and submits. You only approve the merge.

**Do not run `update` yourself.** Updating changes files your project tracks, so doing it by hand puts a change on the default branch without a submission.

**You can name the version to move to.** A tag is cut on every merge, so you can pick a specific release instead of the latest ([ADR 0006](docs/adr/0006-version-bump-policy.md)).

> I want autodrive-dev-kit at v0.1.1

### How development goes

Open Claude Code and say **"I want to start a project."**

From there the AI reads the state of the project and drives.

| | The AI does | You decide |
|---|---|---|
| 1 | Asks what you are building and why, writes it down, and reads it back | Talk |
| 2 | If there is a UI, proposes how it could look | **Choose** |
| 3 | Proposes an order to build in, with the tradeoffs | **Decide** |
| 4 | Builds the environment. Asks you only for things it cannot do itself | Issuing credentials, etc. |
| 5 | Files work items and implements | |

**The environment grows as you need it,** not all at once up front.

#### A submission carries one record from the previous work item

**Normally nothing unrelated to the work shows up in a submission.** This is the one exception, so here it is up front.

A submission may contain a `telemetry/AUT-nnn.jsonl` belonging to a **different** work item. **Nothing is broken, and the AI is not slipping unrelated work in.**

Token usage is recorded when the AI **reports back and stops.** That happens after the commit and the submission, so **the last record cannot make it into its own work item's submission.** It is picked up at the start of the next work item and rides that submission instead.

| What you may wonder | How it is |
|---|---|
| What gets carried | Only records under `telemetry/`. No other file is touched |
| The record itself | **Still belongs to the original work item.** Nothing is re-attributed |
| What to do | Nothing. Merge as usual |

**This shape is interim.** Keeping records off the branch entirely is being considered separately.

## What gets placed

```
my-app/
├── autodrive/                       copy of the toolkit
├── autodrive.json                   your setup
├── boundaries.yaml                  the delegation table
├── CLAUDE.md                        project-specific rules
├── .env.example                     credentials you need. **generated from your setup**
├── .gitignore
├── notes/
│   └── README.md                    **yours to use.** contents are not tracked
├── .claude/
│   └── settings.json                registers the recording hook
├── .github/
│   └── workflows/invariants.yml     runs the checks in CI
├── docs/
│   ├── autodrive.md                 the rules the AI follows
│   ├── what-why.md                  what you are building, and why
│   ├── quality.md                   what quality you protect, and what you do not
│   ├── adr/                         design decisions
│   └── boundary-changes.md          history of delegation changes
├── telemetry/
│   └── <work item id>.jsonl         stops, rework, token spend
└── test/                            tests
```

These appear as the project needs them.

| File | Created | Owned by | Contents |
|---|---|---|---|
| `autodrive/` | init | autodrive-dev-kit | Copy of the toolkit. Replaced by `update` |
| `.env.example` | init | autodrive-dev-kit | Credentials you need. **Generated from your setup** |
| `.github/workflows/invariants.yml` | init | autodrive-dev-kit | Runs the checks in CI |
| `.devcontainer/` | init | autodrive-dev-kit | Isolation logic (firewall, setup, allowlist). **Outbound traffic is allowlisted** |
| `.devcontainer/devcontainer.json` | init | project | The workspace definition. **Edit it directly.** `invariants` checks the isolation wiring |
| `.devcontainer/devcontainer-lock.json` | init | project | Version pins. **Placed once.** After that, the Dev Containers CLI rewrites it on every rebuild |
| `docs/autodrive.md` | init | autodrive-dev-kit | The rules the AI follows. **Includes how it should behave.** Read every session |
| `docs/autodrive-reference.md` | init | autodrive-dev-kit | Why, how to measure, what went wrong before. **Looked up, not read every time** |
| `autodrive.json` | init | project | Your setup. Never changed by `update` |
| `boundaries.yaml` | init | project | The delegation table. What you have handed to the AI |
| `docs/what-why.md` | init | project | What you are building, and why |
| `docs/quality.md` | init | project | What quality you protect, and what you deliberately leave unwatched |
| `CLAUDE.md` | init | project | Project-specific rules |
| `.gitignore` | init | project | Keeps credentials and working state out |
| `notes/README.md` | init | project | **Yours to use.** Contents are not tracked |
| `docs/adr/README.md` | init | project | Index of design decisions and how to write them. **The AI reads it at the start of every work item** |
| `.claude/settings.json` | init | project | **Appends** the recording hook. Existing entries are kept |
| `telemetry/<work item id>.jsonl` | when work starts | project | Stops, rework, token spend |
| `test/` | when you implement | project | Tests |
| `docs/adr/NNNN-*.md` | when a design decision comes up | project | Design decisions. **Written by the AI** |
| `docs/boundary-changes.md` | when the delegation table moves | project | History of delegation changes |

Files owned by autodrive-dev-kit are overwritten by `update`. Files owned by the project are left alone if they already exist.

The last four are not created by `init`. **They hold project-specific content, so no empty stubs are placed.**

## How it fits together

The setup, and the path a single change takes. **Every element is a port and can be swapped.** What the diagram shows is the default setup.

To change a port after setup, tell the AI. It rewrites `autodrive.json` and applies it with `update`. Before changing, it tells you what is lost (for the Tracker, existing work items do not move).

![How it fits together: the human, the sandbox, the record, and the run, with the path a change takes](docs/environment.svg)

### The toolkit is copied into your project

```
  <reference implementation>        <your project>

  autodrive-dev-kit/                my-app/
    src/
      vendored/   ───── init ─────▶   autodrive/       copy of the toolkit
      templates/  ──── renders ───▶   docs/            rules / what-why
    VERSION                           .github/         CI
    LICENSE                           autodrive.json   your setup
```

Updating autodrive-dev-kit changes nothing in your project until you run `update`. Each project runs its own pinned version ([ADR 0004](docs/adr/0004-vendored-kit.md)).

### Inner loop and outer loop

```
  inner   implement ──▶ checks decide ──▶ fix       the AI finishes this alone
                                                    you are not called

  outer   read records ──▶ propose ──▶ you approve  reduces how often you are called at all
```

`boundaries.yaml` holds what you have delegated. **Moving a cell in that table is the outer loop, and needs your approval.** So does introducing a new way of detecting problems.

### Checking the invariants

`invariants` decides whether the placed machinery is actually working. It runs from CI, and you can run it by hand.

```sh
autodrive/invariants --root . --scope self
```

It looks at four things. **Each one is a precondition for the two loops above.**

| What it looks at | What breaks if it fails |
|---|---|
| Whether the outer loop has started and is continuing | Records pile up and never improve anything |
| Whether records exist | The outer loop has no input at all |
| Whether delegation changes are in the history | You lose track of what was handed over, and when |
| Whether the AI can disable any of the above | All three become removable at any time |

Output looks like this.

```
[active]      Telemetry is being recorded
[substituted] The AI cannot disable any of these
[unresolved]  Delegation changes stay in the history
```

**The headings follow the `language` you chose at setup.** The evidence lines under each result are in English; if you chose Japanese, the output says so, and the AI will restate them for you.

There are four states (definition §9). **Each says what something currently is.**

| State | Meaning | Example, for "records exist" |
|---|---|---|
| **active** | Machinery is doing it. Nobody has to remember, and nobody can forget | The hook is registered and records land automatically |
| **substituted** | Not machinery yet; a human is covering it by hand. The fact that they are is itself recorded | Someone remembers to record by hand, and that is written down |
| **unresolved** | No record of anyone covering it, or the state cannot be determined | Someone is recording by hand, but nothing says so |
| **out of scope** | Not judged here | A cross-repository item, looked at from inside one repository |

**Being substituted is not a failure.** The work of building machinery does not yet have that machinery. **Only "unresolved" is treated as failure** — that is what stops "we're basically doing it" from running forever.

The full criteria, how to widen delegation, and how to record a substitution are in [docs/invariants.md](docs/invariants.md) and [docs/commands.md](docs/commands.md).

## Learn more

| Document | Contents |
|---|---|
| [docs/design.md](docs/design.md) | Agreeing on how a screen looks, before implementing it |
| [docs/commands.md](docs/commands.md) | Every command. **Including the ones the AI runs** |
| [docs/invariants.md](docs/invariants.md) | The full checking criteria |
| [docs/adr/](docs/adr/) | Design decisions. **Read before proposing to overturn one** |

## Working on the kit itself

```sh
npm test        # node:test. no test framework dependency
npm run mutate  # puts past defects back and checks that the tests fail
```

**Plain JS, run directly by Node. There is no build step.** Types are written as JSDoc.

Type annotations cannot be used directly. **Node deliberately does not strip types under `node_modules`,** which would break `npx` distribution ([ADR 0001](docs/adr/0001-implementation-language.md)).

**Do not add `dependencies`.** Having none is this kit's supply-chain defence. If you think you need one, read [ADR 0001](docs/adr/0001-implementation-language.md) first and start by proposing to change it.

**When you build something that checks, verify the check itself in the same work item.** Write a test where you can. Where you cannot, confirm the behaviour before submitting. **Confirm that the test fails against a broken implementation** — otherwise a passing test is indistinguishable from one that checks nothing.

Do not do that by hand; `npm run mutate` does it. `mutations/regression.json` holds mutations that put previously fixed defects back into the implementation. **When you fix a defect, add the mutation that reintroduces it.** CI runs this too.

**Done by hand, it is the running of it that breaks.** It broke twice here, and both times read as "everything is caught" (AUT-138). The details are at the top of [src/mutate.js](src/mutate.js).

**When you change what gets distributed, raise `VERSION` and the `version` in `package.json`.** Every submission raises it ([ADR 0006](docs/adr/0006-version-bump-policy.md)). CI fails the submission if you forget, and a tag is cut once it merges. Changes to tests or docs alone do not need it.

## License

[Apache License 2.0](LICENSE). Copyright 2026 Hajime Hashino.

You are free to distribute it, modify it, and use it, including commercially. Please go ahead.

Just keep the `LICENSE` and `NOTICE` files alongside it. `init` copies both into `autodrive/` when you adopt the toolkit in a project, so if you are simply using it there is nothing you need to think about.

The method itself is in a separate repository under a different license. [AI Autodriving Development](https://github.com/hajime-hashino/autodrive-dev-definition) is **CC BY 4.0**, because it is prose rather than code — quote it, translate it, teach from it; just say where it came from.

## Forking

The license lets you fork and go your own way. **Three things in this repository are about *this* project, though, and will not work in yours.**

| What | Why | What to do |
|---|---|---|
| `telemetry/*.jsonl` | The records point at work items in this project's tracker. The checker reports them as **records pointing at work items that do not exist** | Empty the directory. Your records start with your first work item |
| The `cross` job in `.github/workflows/invariants.yml` | It clones four specific repositories that only exist here | Remove the job, or point it at your own layout |
| `mutations/regression.json` | The mutations reintroduce defects that were fixed here. Once you change the implementation they stop matching, and the run reports **not applied** | Replace them as you fix things of your own |

**Whether to carry the telemetry over is a real question.** Keeping it fails the check; dropping it means the record of how this toolkit grew stays only in the original repository. **Dropping it is the recommendation** — that history is not yours to claim, and it is still here to read.

Add your own line to `NOTICE`; Apache-2.0 allows it. If you change a file, say that you changed it (§4(b)).

CI needs two secrets: `AUTODRIVE_CI_TOKEN` and the Tracker credential.

| `ports.tracker` | Tracker credential |
|---|---|
| `linear` | `LINEAR_API_KEY` |
| `github-issues` | `GH_TOKEN` (add `Issues: Read and write`; set `AUTODRIVE_TRACKER_TOKEN` only if you want a separate one) |

With `github-issues`, `autodrive.json` needs `tracker.prefix` — the 2-4 characters that lead each work item ID, as in `AIEP-123` (ADR 0013). **`init` asks for it**, suggesting one derived from the repository name; press Enter to take the suggestion.
