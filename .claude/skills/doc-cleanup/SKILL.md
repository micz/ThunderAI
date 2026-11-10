---
name: doc-cleanup
description: Audit and clean a repo's markdown docs for agent-context rot — completed-work logs, executed plans never rewritten, stale facts, internal contradictions, dead paths. Use when the user asks to evaluate/clean up docs, says docs are "hurting agent thinking", mentions "doc debt", "stale docs", "docs cleanup", or when agent-entry docs (CLAUDE.md/AGENTS.md and their required reading) have grown fat with history.
---

# Doc cleanup — remove context rot from agent-facing docs

Docs that agents must read every session are paid for in context tokens and,
worse, in wrong conclusions: a stale fact in an "authoritative" doc beats a
correct fact an agent never looks up. This skill audits, then archives history
and rewrites live docs down to current facts.

**Two-phase contract: diagnose first, report findings, and only execute after
the user approves.** Never silently rewrite docs.

## Phase 1 — Inventory

1. `find . -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*" | xargs wc -l | sort -rn`
2. Read the agent-entry docs (`CLAUDE.md`, `AGENTS.md`, and every doc they
   instruct agents to read before working). These cost context in *every*
   session — weight them highest. A 400-line doc read once a month is cheap;
   a 150-line doc on the "read before you code" list is expensive.

## Phase 2 — Diagnose (read-only)

Hunt six rot patterns. For each hit, note file, lines, and severity.

1. **Completed-work logs.** Checklists that are ~all `[x]`, phase logs full of
   ✓, implementation narratives, bug post-mortems, verification transcripts.
   History belongs in git and archives, not in every session's context.
2. **Executed plans never rewritten.** A plan/strategy doc whose steps all
   shipped reads as *intent* but is consumed as *fact* — and its pre-decision
   analysis (superseded tables, rejected options) actively misleads.
3. **Internal contradictions.** A table "fixed" by a supersession note below
   it instead of being edited; the same fact stated with two values in one
   doc; stacked dated addenda where a later one reverses an earlier one.
4. **Stale facts vs code.** Before flagging anything, **verify against the
   code**: grep for referenced files, symbols, constants, and line refs. Doc
   claims are hypotheses; the repo is the evidence. Typical finds: renamed
   components, changed config values, wrong `file.ts:NN` refs, "awaiting
   merge" statuses for work already on main (`git merge-base --is-ancestor`).
5. **Dead paths.** Old OS paths after a machine migration, moved sibling
   repos, deleted files, tooling that no longer exists.
6. **Authority drift.** A doc crowned "source of truth" (design spec, API
   contract) that the code has legitimately outgrown. Agents will "fix"
   correct code back toward the stale spec.

Also mark what is **load-bearing and must survive**: hard rules, recurring
traps/gotchas, do-not-do warnings, domain glossaries. Recurring traps are not
history even when they were discovered historically.

## Phase 3 — Report

Present findings worst-first, each with concrete evidence (quote the
contradiction, show the failed grep). Rank by context cost × misdirection
risk. Propose the cleanup plan and stop for approval.

## Phase 4 — Execute (after approval)

Per-file playbook:

- **Archive, don't delete.** Copy the old doc (or extracted section) verbatim
  to `docs/archive/<name>-<YYYY-MM>.md`. Verify verbatim:
  `git show HEAD:<file> | diff - docs/archive/<name>-<YYYY-MM>.md`.
- **Rewrite the live doc to current facts only**, with a one-line pointer to
  the archive. Every fact you write must be re-verified against code at write
  time — never copy a claim forward from the old doc.
- **Point at sources of truth instead of duplicating them** (the config
  constant, the schema file), so the doc can't drift again.
- **Collapse done checklists** to one-line `✓` summaries; keep only open
  items, with their original wording.
- **Keep the traps.** Extract recurring gotchas from archived logs into the
  live doc (short, imperative) before archiving the log.
- **Banner superseded authorities** rather than rewriting them: a status
  block at the top saying what drifted and that code + the deviation log win.
- **Fix entry docs** (CLAUDE.md/AGENTS.md/README): dead paths, feature claims
  for things that don't exist, missing pointers to the cleaned docs.

## Phase 5 — Verify & hand over

- Every relative link in touched files resolves (including new archive files).
- `git status` shows only the intended markdown files.
- **Never show the full diff in chat** (CLAUDE.md rule 10). Summarize what
  changed: each touched file as a clickable link with a short description.
  The maintainer reads the actual diff in the editor or via git. Short
  snippets only when needed to explain a specific decision.
- **Never commit, stage or branch, and never ask or offer to** (CLAUDE.md
  rule 9). Leave the work in the working tree and end with a one-line commit
  message the maintainer can use, in single quotes, never double. If the
  maintainer asks for changes, apply them and summarize them the same way.

## Delegation

The execute phase is bulk clear-spec work — suitable for a cheaper model via
subagent, with a self-contained spec listing every verified fact it needs (it
must not re-derive facts). Diagnosis and the final diff review need judgment:
do those in the main thread. Always review the subagent's diff line-by-line;
expect to catch small semantic errors (e.g. "unlocks manual moderation"
flattened to "moderation: manual"). The Phase 5 handover is main-thread-only,
and a subagent must never run `git add` or `git commit`.