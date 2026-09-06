# autodrive-dev-kit

**A toolkit that lets you build software with AI, without needing to be an engineer yourself.**

Reference implementation of [AI Autodriving Development](https://github.com/hajimegane/autodrive-dev-definition).

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
npx github:hajimegane/autodrive-dev-kit init
```

**No clone, no PATH setup.** Node 22.18 or newer is all you need.

That command is long to type, so you may put it on your PATH instead.

```sh
export PATH="$PATH:<where you keep this reference implementation>/bin"
autodrive-dev-kit init
```

It asks about your setup. **The first question is your language** (日本語 / English). Each question shows its options and a recommendation, so type a number or just press Enter. Answers are saved to `autodrive.json` and you are not asked again.

**That language setting only affects setup.** During development the AI speaks whatever language you speak.

| Command | Used for |
|---|---|
| `init` | Adopt in a new project. Asks about the setup, then places files |
| `apply` | Adopt in an existing project. Infers the setup from what is already there and asks you to confirm |
| `update` | Move the toolkit to a newer version. Does not ask about the setup, and does not change what you already decided |

Copy the placed `.env.example` to `.env` and fill in your credentials. That is the end of the manual work.

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
│   ├── adr/                         design decisions
│   └── boundary-changes.md          history of delegation changes
├── telemetry/
│   └── <work item id>.jsonl         stops, rework, token spend
└── test/                            tests
```

These appear as the project needs them.

| File | Created | Owned by | Contents |
|---|---|---|---|
| `autodrive/` | init | dev-kit | Copy of the toolkit. Replaced by `update` |
| `.env.example` | init | dev-kit | Credentials you need. **Generated from your setup** |
| `.github/workflows/invariants.yml` | init | dev-kit | Runs the checks in CI |
| `.devcontainer/` | init | dev-kit | The isolated workspace the AI runs in. **Outbound traffic is allowlisted** |
| `docs/autodrive.md` | init | dev-kit | The rules the AI follows. **Includes how it should behave** |
| `autodrive.json` | init | project | Your setup. Never changed by `update` |
| `boundaries.yaml` | init | project | The delegation table. What you have handed to the AI |
| `docs/what-why.md` | init | project | What you are building, and why |
| `CLAUDE.md` | init | project | Project-specific rules |
| `.gitignore` | init | project | Keeps credentials and working state out |
| `notes/README.md` | init | project | **Yours to use.** Contents are not tracked |
| `.claude/settings.json` | init | project | **Appends** the recording hook. Existing entries are kept |
| `telemetry/<work item id>.jsonl` | when work starts | project | Stops, rework, token spend |
| `test/` | when you implement | project | Tests |
| `docs/adr/` | when a design decision comes up | project | Design decisions |
| `docs/boundary-changes.md` | when the delegation table moves | project | History of delegation changes |

Files owned by dev-kit are overwritten by `update`. Files owned by the project are left alone if they already exist.

The last four are not created by `init`. **They hold project-specific content, so no empty stubs are placed.**

## How it fits together

### The toolkit is copied into your project

```
  <reference implementation>        <your project>

  autodrive-dev-kit/                my-app/
    src/          ───── init ─────▶   autodrive/       copy of the toolkit
    invariants                        autodrive.json   your setup
    VERSION                           docs/            rules / what-why
    templates/                        .github/         CI
```

Updating dev-kit changes nothing in your project until you run `update`. Each project runs its own pinned version ([ADR 0004](docs/adr/0004-vendored-kit.md)).

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

**It follows the `language` you chose at setup.** The evidence lines under each result are still Japanese; the output says so, and the AI will restate them for you.

There are four states (definition §9). **Each says what something currently is.**

| State | Meaning | Example, for "records exist" |
|---|---|---|
| **active** (有効) | Machinery is doing it. Nobody has to remember, and nobody can forget | The hook is registered and records land automatically |
| **substituted** (代替) | Not machinery yet; a human is covering it by hand. The fact that they are is itself recorded | Someone remembers to record by hand, and that is written down |
| **unresolved** (要対応) | No record of anyone covering it, or the state cannot be determined | Someone is recording by hand, but nothing says so |
| **out of scope** (対象外) | Not judged here | A cross-repository item, looked at from inside one repository |

**Being substituted is not a failure.** The work of building machinery does not yet have that machinery. **Only "unresolved" is treated as failure** — that is what stops "we're basically doing it" from running forever.

The full criteria, how to widen delegation, and how to record a substitution are in [docs/invariants.md](docs/invariants.md) and [docs/commands.md](docs/commands.md).

## Learn more

| Document | Contents |
|---|---|
| [docs/environment.html](docs/environment.html) | **What runs where, on one page.** The setup and the path a change takes |
| [docs/design.md](docs/design.md) | Agreeing on how a screen looks, before implementing it |
| [docs/commands.md](docs/commands.md) | Every command. **Including the ones the AI runs** |
| [docs/invariants.md](docs/invariants.md) | The full checking criteria |
| [docs/adr/](docs/adr/) | Design decisions. **Read before proposing to overturn one** |

**These are written in Japanese.** Ask the AI and it will explain any of them in your language — that is required of it, and it always reads the current version, so its answer never goes stale.

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

## License

[Apache License 2.0](LICENSE). Copyright 2026 Hajime Hashino.

**The toolkit is copied into your project, and the license travels with it.** `init` places `LICENSE` and `NOTICE` inside `autodrive/`, so the copy is never orphaned.

The method itself lives in a separate repository and is licensed differently: [AI Autodriving Development](https://github.com/hajimegane/autodrive-dev-definition) is under **CC BY 4.0**, because it is prose rather than code.
