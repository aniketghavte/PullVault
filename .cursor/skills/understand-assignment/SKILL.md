---
name: understand-assignment
description: Loads the PullVault work-trial brief and architecture document so the agent can answer "what does the assignment require for X?" or "is feature Y in scope?" with grounded answers. Use when the user asks about scope, requirements, parameters, evaluation criteria, P0/P1/P2 priorities, the EV math, or anything that begins with "the assignment says..." / "what does the trial want here?" / "is this needed?".
---

# Understanding the PullVault Assignment

PullVault is a work-trial project. The brief is **the source of truth** for scope. When the user asks an "is this required?" or "does the spec want this?" question, do **NOT** answer from memory — read the brief and the architecture doc, then answer specifically.

## Step 1 — Always read both files first

Use the Read tool to load:

1. `assignment.md` — the brief
2. `architecture.md` — our committed design + parameter justifications

These are short. Read them in full unless the question is unambiguously about one section.

## Step 2 — Answer in three parts

When you respond, structure like this:

1. **What the brief says** (quote or paraphrase, with section reference).
2. **What we've already committed to in `architecture.md`** (parameter values, EV math, anti-snipe choice, fee rates).
3. **Recommendation for the user's specific question.**

If the brief is silent and `architecture.md` is silent, say so explicitly and propose a default — don't fabricate a requirement.

## Step 3 — Use the priority guide

The brief has a P0 / P1 / P2 list. Use it whenever the user asks "should I build X next?":

- **P0** must work perfectly. Don't ship without it.
- **P1** should work. Acceptable to leave rough.
- **P2** nice to have. Acceptable to skip.

## Step 4 — Map every claim to a section

When citing the brief, reference the heading (`## Pack Drop System`, `## Live Auction Room`, `## Tech Stack`, etc.). When citing our architecture, reference the section number (`§4 Concurrency`, `§5 Pack EV Math`, `§6 Anti-Snipe`).

## Step 5 — Watch for things the trial reviewers will probe

The brief explicitly lists what the review call will test:

- "Show me the code that handles two users buying the last pack simultaneously."
- "What happens if the auction WebSocket disconnects mid-bid?"
- "Walk me through a trade transaction — what guarantees atomicity?"

When the user asks about implementation choices in those areas, raise the bar: the answer must be defensible at the code level, not just the design level.

## Step 6 — Do not invent parameters

Pack prices, rarity weights, fees, durations, anti-snipe window — all are in `packages/shared/src/constants.ts` and justified in `architecture.md`. If the user asks "what's the trade fee?", read the constants file. If they want to change it, update `constants.ts` AND the EV / margin tables in `architecture.md`.

## Quick checklist

Before answering an assignment question:

- [ ] I read `assignment.md`.
- [ ] I read `architecture.md`.
- [ ] My answer cites at least one of them.
- [ ] If I'm proposing a change, I've identified the file(s) that need to update together (constants + architecture + README).
