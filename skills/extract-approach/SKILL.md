---
name: extract-approach
description: >
  Capture edge-case reasoning, failed approaches, and novel solutions before
  they are lost at session end. Fires on session close, first-seen errors,
  novel solutions, budget/cache/compression anomalies, model rotations, and
  prefix mutations. Writes one draft note per insight to The Brain following
  PROTOCOL §4 (quarantine) and §7 (lessons format). The learning law: no
  session that produced a novel insight may end without writing it down.
triggers:
  - session_end
  - error_first_seen
  - novel_solution
  - budget_alert
  - cache_hit_rate_drop
  - compression_ratio_anomaly
  - model_rotation
  - prefix_mutation_detected
version: 1.0.0
status: draft pending G10 second-agent verification
owner: andre-brassfield
---

# extract-approach — the Learning Law

## Section 1 — Trigger Conditions

Fire this skill when ANY of the following occurs. Evaluate the list at session end AND at each event below as it happens (don't wait for session end — sessions can die).

1. **Session end** (always evaluate): before the final response of a session that wrote code, changed config, or resolved a non-trivial problem, run the extraction check (Section 5 threshold).
2. **Error first seen**: an error message whose signature (first line, normalized) does not appear in any existing note under `~/The-Brain/07-Lessons-Memory/` or in `01-Inbox/tv-extract-*`. Example from source session: `fatal: Unable to create '.git/index.lock': File exists` from a crashed prior writer.
3. **Novel solution**: the working fix differs from the first attempted fix. If APPROACH_1 ≠ FINAL_SOLUTION, extract.
4. **Budget alert fires** (budget.js warning ≥80% or critical ≥100%): extract what was spending and what action was taken (CLAUDE.md B4 already requires the ChangeLog entry; this note captures the *reasoning*).
5. **Cache hit rate drops below 70%** (`getCacheHealth()` returns warning or worse): extract which of the six B1 checks explained it — that mapping is the reusable knowledge.
6. **Compression ratio anomaly**: `stats.compressionRatio > 95` (B2) or a compression-audit (C2) flags ≥1 anomaly.
7. **New model added or rotated** (B3/C3): extract the benchmark surprise, if any — the gate table goes in 06-Decisions/, the *why* goes here.
8. **Prefix mutation detected**: `validatePrefixStability()` returns `stable: false` or `detectMutablePrompt()` returns `mutable: true` on a prompt that was previously clean.

## Section 2 — The Learning Law

**No session that produced a novel insight may end before that insight is written to The Brain as a draft note a mid-tier model can act on.**

Why it matters: session reasoning is the only place where "what we tried and why it failed" exists — code shows the final state, git shows the diff, but neither records the two approaches that DIDN'T work or the false premise that was corrected. A fleet running mid-tier models re-pays the full discovery cost for every undocumented insight. One verified case: the top-level `cache_control` bug survived because a test asserted the bug — the insight "a passing test proves conformance to its author, not to reality" is worth more than the fix itself.

Three good extractions from the source session (2026-07-06):

1. **The .gitignore ambush**: a file named `tokenvault-bug-case-studies.md` was silently excluded from a commit because PROTOCOL §5's `*token*` secret pattern matched the filename. Insight: secret-pattern globs match FILENAMES too; check `git check-ignore -v <path>` whenever a `git add` seems to succeed but the file doesn't appear in the commit stat.
2. **Folklore metrics**: an "88% cache hit rate, verified live" claim directed a fix in the wrong direction; the actual state file showed 38.1%, and the figure traced to a commit message about a different provider. Insight: numbers in commit messages or prompts are claims, not evidence — read the state file/trace artifact before acting on any metric (PROTOCOL §2).
3. **Mount-lag false positive**: sandbox reads of tracker.js showed a stale pre-fix version while the host file was already fixed, nearly producing a wrong "consolidation incomplete" claim in a permanent note. Insight: when two views of the same file disagree, re-verify on the authoritative side (host) before recording either version as fact.

## Section 3 — Extraction Template

Copy this template exactly. One note per insight (PROTOCOL §7: one lesson per file). Line 1 after frontmatter must be the one-sentence summary (§7 format).

```markdown
---
status: draft
type: extraction
session_id: {SESSION_ID}        # auto-fill from runtime; if unavailable, agent+date
timestamp: {YYYY-MM-DDTHH:MMZ}  # auto-fill; verify with `date -u` — do not guess
trigger: {one of the 8 Section-1 triggers}
agent: {agent-id}
verification: pending per PROTOCOL §4/G10
---

{ONE-SENTENCE SUMMARY — this is the line future greps will find}

PROBLEM: {what the agent was trying to solve, 1-2 sentences}
APPROACH_1: {first thing tried}
RESULT_1: {what happened, with the exact error/output line if applicable}
APPROACH_2: {second thing tried, or "n/a — first approach worked" }
RESULT_2: {what happened, or "n/a"}
FINAL_SOLUTION: {what worked, specific enough to repeat}
KEY_INSIGHT: {the 1-sentence takeaway a mid-tier model can apply}
EDGE_CASES: {what could go wrong for future models applying this}
MODEL_NOTES: {anything for future instances: assumptions made, what was NOT verified}
FILES_TOUCHED: {exact paths, or "none"}
TESTS_ADDED: {test file paths + what each covers, or "none — explain why"}
CLAUDE_MD_RULES: {rules applied, violated, or newly needed (cite section+number)}
```

## Section 4 — Integration Rules

1. **Where notes go — DEVIATION FROM COMMON INSTRUCTION, on purpose**: notes are saved to `~/The-Brain/01-Inbox/tv-extract-YYYY-MM-DD-HHMM.md`, NOT to a new `~/The-Brain/lessons/` folder. Rationale: (a) PROTOCOL §4 quarantines all new content in 01-Inbox as `status: draft` until a different context verifies it; (b) the vault's canonical lessons folder is `07-Lessons-Memory/` — creating a parallel `lessons/` directory repeats the vault-proliferation failure documented in `07-Lessons-Memory/Lesson-011-Vault-Proliferation-Default.md`. Promotion path: 01-Inbox draft → second-agent verification (G10) → merge into `07-Lessons-Memory/` per its README (update an existing lesson rather than duplicating).
2. **How future models find extractions**: `grep -ril "<topic keyword>" ~/The-Brain/07-Lessons-Memory/ ~/The-Brain/01-Inbox/` — the line-1 summary and KEY_INSIGHT field make keyword grep effective. Also check `00-System/INDEX.md` first (PROTOCOL §1.3: don't open 3+ files hunting).
3. **Override vs append**: never overwrite an existing note. If a new extraction contradicts an old one, write the new note, cite the old one by filename, and flag the conflict per PROTOCOL §6 (`06-Decisions/Conflict-Report-YYYYMMDD-<topic>.md` if agents disagree; a simple supersedes-line if it's the same agent correcting itself). During promotion, §7 says update-in-place is preferred — that happens at promotion, not at extraction.
4. **Avoiding the .gitignore ambush**: filenames must start `tv-extract-`. NEVER include the substrings `token`, `secret`, `key`, or `password` in a filename — PROTOCOL §5's enforced .gitignore (`*token*`, `*secret*`, `*.key`) silently excludes them. After every commit, verify the file actually landed: `git show --stat HEAD | grep tv-extract` — if absent, run `git check-ignore -v <path>`.
5. **Commit discipline**: extraction notes commit under PROTOCOL §5 message format with `evidence=` naming the trigger artifact (trace line, test output, state file value). A protocol-read line (§1.2) must exist for the session.

## Section 5 — Quality Bars

**Anti-patterns (all three occurred or nearly occurred in the source session):**

1. *Restating the diff*: "Changed reorderEnabled from true to false in compressor.js." — git already records this durably (§7 says don't store what git records). BAD. The extractable part is: "reordering was added to fight lost-in-the-middle and silently zeroed prefix caching — optimization layers can fight each other; evaluate stages on system cost, not stage metrics."
2. *Unverified claim as insight*: "Anthropic caching achieves 88% hit rate with top-level cache_control." — a claim from a commit message, contradicted by the state file. An extraction containing a number MUST name the artifact the number came from, or omit the number.
3. *Vague moral*: "Always be careful with gitignore." — fails the mid-tier test; not actionable. GOOD version names the exact pattern (`*token*`), the exact detection command (`git check-ignore -v`), and the exact convention that avoids it (`tv-extract-*`).

**Good-extraction markers (annotated):**

1. Names an exact reproduction/detection command — "`git show --stat HEAD | grep <file>` to confirm the commit contains the file" [actionable without context].
2. Records the FAILED approach with its actual output — "`rm .git/index.lock` → `Operation not permitted` → needed deletion-permission grant first" [saves the next model the dead end].
3. States scope honestly in MODEL_NOTES — "live cache behavior NOT verified; constraint forbade API calls; next session run tests/integration.js with a key" [prevents false-completion inheritance; PROTOCOL §2].

**Minimum threshold**: if the note contains zero novel insights — nothing a competent model wouldn't already do, and nothing git/ChangeLog already records — do NOT save it. An empty-calorie note costs future context tokens forever (every extraction is a permanent tax on `brain-ground` injection budget, currently 800 tokens).

**The 10-second test**: a mid-tier model reading ONLY the line-1 summary and KEY_INSIGHT must know (a) when this applies to them and (b) what to do differently. If either requires reading PROBLEM/APPROACH fields, rewrite the summary.

## Section 6 — File Naming Convention

1. Pattern: `tv-extract-YYYY-MM-DD-HHMM.md` (24h clock, minutes prevent same-session collisions). Timestamp from `date -u '+%Y-%m-%d-%H%M'` — never guessed (a wrong hand-written timestamp shipped in the source session's ChangeLog and needed a fixup).
2. Forbidden filename substrings: `token`, `secret`, `key`, `password` — all match enforced .gitignore patterns (§5) and will be silently excluded from commits.
3. Location: `~/The-Brain/01-Inbox/` (always exists; do NOT create new top-level vault folders — §11 requires a proposal + Dre's approval for structural changes).
4. Multiple insights in one session = multiple files, same timestamp prefix + `-a`, `-b` suffixes, one insight each (§7: one lesson per file).
