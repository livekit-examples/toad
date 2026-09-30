# AGENTS.md — toad (Iris)

> Guidelines for AI coding agents working in this repository.

---

## RULE 0 — THE FUNDAMENTAL OVERRIDE PREROGATIVE

If I tell you to do something, even if it goes against what follows below, YOU MUST LISTEN TO ME. I AM IN CHARGE, NOT YOU.

---

## RULE NUMBER 1: NO FILE DELETION

**YOU ARE NEVER ALLOWED TO DELETE A FILE WITHOUT EXPRESS PERMISSION.** Even a new file that you yourself created, such as a test code file. You have a horrible track record of deleting critically important files or otherwise throwing away tons of expensive work. As a result, you have permanently lost any and all rights to determine that a file or folder should be deleted.

**YOU MUST ALWAYS ASK AND RECEIVE CLEAR, WRITTEN PERMISSION BEFORE EVER DELETING A FILE OR FOLDER OF ANY KIND.**

---

## Irreversible Git & Filesystem Actions — DO NOT EVER BREAK GLASS

1. **Absolutely forbidden commands:** `git reset --hard`, `git clean -fd`, `rm -rf`, or any command that can delete or overwrite code/data must never be run unless the user explicitly provides the exact command and states, in the same message, that they understand and want the irreversible consequences.
2. **No guessing:** If there is any uncertainty about what a command might delete or overwrite, stop immediately and ask the user for specific approval. "I think it's safe" is never acceptable.
3. **Safer alternatives first:** When cleanup or rollbacks are needed, request permission to use non-destructive options (`git status`, `git diff`, `git stash`, copying to backups) before ever considering a destructive command.
4. **Mandatory explicit plan:** Even after explicit user authorization, restate the command verbatim, list exactly what will be affected, and wait for a confirmation that your understanding is correct. Only then may you execute it.
5. **Document the confirmation:** When running any approved destructive command, record (in the session notes / final response) the exact user text that authorized it, the command actually run, and the execution time.

This applies doubly to the persistent SQLite databases (backend store and tracker). Never delete, truncate or re-seed them outside the developer-only seed/reset path, and never during a rehearsal or judging window.

---

## Branch Policy

- Primary branch is `main`.
- Do not reference `master` in docs/scripts.

---

## Project Mission

toad builds **Iris**, a configurable voice assistant that investigates a developer issue while its owner is away, presents **one evidence-backed comment** for approval, and publishes **exactly the approved revision**. LiveKit carries the browser conversation and the outbound phone call. A small persistent backend owns the work, permissions, decisions and result receipts.

It is a three-developer MVP for a 48-hour event (September 30, 2026) and a **supervised demo deployment**, not a production service.

**The single source of truth is [`toadPlan.master.md`](toadPlan.master.md).** Read it before writing any code. The per-developer plans divide its implementation:

- [`toadPlan.dev-A.md`](toadPlan.dev-A.md): voice agent and outbound approval calls
- [`toadPlan.dev-B.md`](toadPlan.dev-B.md): backend, contracts and durable execution
- [`toadPlan.dev-C.md`](toadPlan.dev-C.md): web client, demo tracker and demonstration

If a per-developer plan disagrees with the master plan, the master plan wins. **Features absent from the master plan are outside this MVP.**

### The demo flow (what everything serves)

1. A signed issue event, authenticated demo button or spoken delegation creates durable work.
2. The worker reads the issue and a fixed code snapshot, drafts a short reply and links the evidence.
3. The owner sees the exact comment, target and evidence in the web inbox.
4. A call-eligible decision rings in the web app. If unanswered, one outbound call asks the owner to authenticate before any private detail is disclosed.
5. The owner edits the comment. Iris creates a replacement revision, reads it in full and accepts an explicit decision.
6. The executor submits that approved revision and displays a confirmed receipt. Lost responses are reconciled; uncertain outcomes remain visible.

### Glossary

| Term | Meaning |
| --- | --- |
| Owner | The single human who configures Iris and decides on proposals |
| Dot | One assistant instance; the voice agent's dispatch name is `dot-agent` |
| Job | Durable unit of investigation work, created from a trigger or delegation |
| Approval lineage / revision | Stable `approval_id`; each edit creates a new immutable `(approval_id, revision)` with a fresh `action_id` |
| Envelope / digest | The normalized immutable action an approval authorizes, and its hash |
| Read-back ticket | Proof that the full deterministic read-back of one revision finished playing |
| Submission gate | The atomic point where `submission_started_at` is set; before it, cancellation prevents the write |
| Receipt | The tracker's immutable record of a created comment, looked up by `action_id` |
| Outreach | The persisted web-ring → phone-call escalation for one approval lineage |

---

## Stack

| Component | Directory | Owner | Stack |
| --- | --- | --- | --- |
| Voice agent | `dot-agent/` | Dev A | Python, LiveKit Agents starter, deployed on LiveKit Cloud; pytest |
| Backend | `backend/` | Dev B | Python, one Uvicorn worker, SQLite (WAL) on a persistent volume |
| Web client | `web/` | Dev C | React starter, TypeScript client generated from the backend OpenAPI |
| Demo tracker | `demo-tracker/` | Dev C | HTTP MCP server on the locked MCP SDK, own persistent tables |
| Shared records | `shared/` | Dev B | Canonical config and record definitions |
| Contracts | `contracts/` | Dev B | OpenAPI, checked fixtures, `compatibility.md` |
| Configs | `configs/` | Dev B (schema), Dev C (demo profile) | Validated YAML profiles |
| Personas | `personas/` | Dev A | Bundled, allowlisted persona files |
| Scripts | `scripts/` | Each author | Test and rehearsal helpers |

The master plan draws these under a `dot/` root; in this repo they live at the top level.

- **Pin versions.** Agents SDK, provider plugins, MCP SDK, CLI and starter commits are pinned by hour two. Commit lockfiles. Record actual model/voice IDs, provider auth, deployment capabilities and region in `contracts/compatibility.md`.
- **Do not add dependencies or frameworks** beyond what the owning developer has pinned. Check `contracts/compatibility.md` before assuming an API exists; the plan's examples define the contract, not a claim that an implementation exists.

---

## Ownership and Contracts

- **Stay in your lane.** Each directory has one owner (table above). Changes to another developer's area are coordinated with that owner first.
- **Dev B owns the canonical names.** Schemas, routes and records come from `contracts/` (checked OpenAPI and fixtures). Use generated/shared types. **Never invent routes or fields** in the agent or the web client.
- **Breaking contract changes move together:** schema, fixtures and every client are updated in the same change. Report contract problems to B with a minimal failing fixture.
- IDs for jobs, sessions, approvals, actions and outreach are backend-generated and opaque. Delivery IDs and tracker issue/evidence identities come from their authenticated source. All times are UTC.
- Errors are `{code, message, retryable, correlation_id, current_revision?}`. Stale revision/digest/state and a reused idempotency key with different content return **409**. A retry with the same key and body returns the existing result.

---

## Non-Negotiable Invariants (READ THIS BEFORE TOUCHING APPROVALS, EXECUTION OR PHONE CODE)

These come from the master plan's approval and execution rules. Breaking any of them breaks the product's core promise: **exactly the approved comment is published, and nothing else.**

### Writes and permissions

1. **Only the executor writes.** Only the executor's internal path calls `tracker/create_comment`. The voice agent holds no MCP credentials and never performs external writes. The model gets read and proposal descriptors only, never a callable write handle. ToolRuntime rejects unregistered or hidden tool references even when guessed.
2. **Two-key permission.** A capability must be allowed by both the job/session snapshot **and** the current active policy. Execution rechecks active policy, connector identity and schema at the submission gate. New grants need a new session; revoked grants block future submission.
3. **YAML cannot reach the network or secrets.** The backend deployment registry fixes tracker URL, identity, transport and tokens. YAML cannot supply URLs, commands, credentials or phone numbers. Persona paths are bundled and allowlisted. Config save **never** falls back to a permissive default.

### Approvals and consent

4. **One approval, one immutable envelope.** The backend builds the exact preview and hashes the full envelope (IDs, revision, tool/schema identity, connection, target/args, evidence/issue revision, expiry). Preserve comment bytes; inject no execution-time defaults. Reject unknown JSON fields, duplicate keys and invalid targets. Secrets stay outside the envelope.
5. **The model never picks the execution key.** `action_id` is a reserved argument injected by the executor. The model's proposal schema exposes only issue ID, text and expected issue revision.
6. **First valid decision wins.** Decisions are an atomic conditional `pending → approved|denied` transition. Stale, expired, superseded, already-resolved or unauthenticated decisions enqueue no write.
7. **Voice consent needs a completed read-back.** Read-back uses deterministic text with the issue target and the full comment; a model summary can never replace or shorten it. Only complete audio playout enables a voice decision. Interruption, edit or disconnect clears completion. An early, unrelated, ambiguous or negated "yes" is not consent.
8. **Edits restart consent.** An edit supersedes the pending revision with a fresh `action_id` and requires a fresh full read-back. The owner lineage, call and attempt cap carry over; consent does not.

### Execution and recovery

9. **The submission gate is atomic.** Persist the attempt and `submission_started_at` before the network call, with cancellation/revocation checked in the same transaction. Network calls happen **outside** database transactions. Cancellation that wins before the gate prevents any call; after the gate, report "may be in flight" and never promise cancellation.
10. **Never assume an outcome.** A timeout or crash after possible submission is `outcome_unknown`. Reconcile through the tracker's backend-only `GET /receipts/{action_id}`. Retry with the same key only while consent, expiry and current policy still authorize it. Store a verified receipt before marking success.
11. **The database is the queue.** Commit each state change together with its event/work intent. Pending approvals are the execution queue; outreach rows are the contact queue. In-memory asyncio tasks are conveniences; restart recovery reads the records.

### Privacy and untrusted input

12. **Phone sessions are private-data-free until the PIN is verified.** Before verification, only generic startup, auth and contact status/cleanup are allowed. The backend verifies the PIN against a hash with at most three attempts and a 30-second deadline. Caller ID, SIP pickup and AMD never establish identity.
13. **Secrets and PINs never leak.** Keep PINs, credentials and secret-bearing requests out of model input, transcripts, logs and events. Browsers receive only the owner context and short-lived room tokens.
14. **Source text is untrusted data.** Issue, trigger and tool text is labeled untrusted and can never change persona, permissions or tools. The web renders it as plain text or sanitized Markdown and never executes returned HTML.

### Outreach limits

15. **Outbound calling is off by default** and enabled only for the verified presenter and the configured demo trigger. Only the validated trigger/profile sets call eligibility; the demo button never grants it. At most one attempt per approval lineage and two calls per hour. No blind redial. **Never bypass the call cap to rehearse.**

---

## Backend Runtime Rules

- One backend replica, one Uvicorn worker, one application lifespan owner for background loops.
- SQLite with WAL, foreign keys, a busy timeout and a persistent local volume. Keep transactions short.
- No generic outbox framework in v1; the approval and outreach rows are the durable queues.
- The worker runs at most two jobs, only registered reads, at most two parallel independent reads, and checks cancellation, deadline and budgets before each step and before proposing.
- Use snapshot polling, not SSE: the web polls every second while active, the agent every two seconds. Polling is lightweight IO and **never** triggers a model call. Current records are authoritative; events are hints.

---

## Scope Discipline

The MVP is intentionally narrow. **Do not build** any of these unless the master plan is explicitly updated:

cron, inbound phone numbers/calls, real Linear/GitHub integration, OAuth, arbitrary stdio/filesystem/shell access, freeform memory, Slack, handoffs, discovery, video, multiple actions per job, quiet hours, snooze/digests, SSE, config rollback UI, distributed workers and production isolation.

Prefer the smallest change that moves the current build gate:

| Hours | Gate |
| --- | --- |
| 0–2 | **G0:** versions/contracts recorded, browser voice turn, outbound call attempted |
| 2–6 | **G1:** durable seeded job and decision, live tracker probe, trunk decision |
| 6–16 | **G2:** live investigation → web decision → exact verified comment; duplicate/restart tests |
| 16–28 | **G3:** authenticated phone edit → fresh read-back → exact receipt; failures keep the inbox |
| 28–40 | **G4:** critical negative/fault cases pass; config demo works |
| 40–48 | **G5:** two clean full rehearsals and a usable web fallback |

If G2 slips, freeze feature work and pair on the failing transition. **Features freeze at hour 40; deploys freeze one hour before judging.** The web approval path must always work on its own; phone is the path that gets cut if its dependency stays blocked.

---

## Code Editing Discipline

### No Script-Based Changes
**NEVER** run a script that mass-edits code files. Brittle regex transforms create more problems than they solve. Make code changes manually (use parallel subagents for many simple changes; do subtle/complex changes methodically yourself).

### No File Proliferation
Revise existing files in place. **NEVER** create `executor_v2.py` / `inbox_new.tsx` / `worker_improved.py`. New files are reserved for genuinely new functionality; the bar is incredibly high.

---

## Backwards Compatibility

We are in early development with **no users**. Do things the **RIGHT** way with **NO TECH DEBT**. Never create compatibility shims or wrappers for deprecated APIs. Just fix the code directly. (Contract changes still move schema, fixtures and clients together; see Ownership and Contracts.)

---

## Mandatory Checks After Substantive Changes

Each component's owner records its exact format, lint, type-check and test commands here once the component is scaffolded and its versions are pinned. Until then:

- Run the tests of every component you touched (pytest for the Python components) and confirm they pass before handing off.
- Validate any change to `contracts/` against the checked fixtures.
- Run `ubs --diff` and review its findings.

If any check fails, fix root causes before handing off.

---

## Testing Policy

Tests assert **effects and authoritative state**, not one exact model tool-call sequence. Use controllable backend/speech fakes for deterministic authority and playout tests; use real calls to validate audio, DTMF and AMD. All three developers use the same valid/invalid fixtures from `contracts/`.

The master plan's verification matrix is the release bar:

| Test | Pass condition | Lead |
| --- | --- | --- |
| Permissions/config | Guessed or revoked tool, invalid target/schema/default and malformed deployed metadata are rejected | B with A |
| Delivery/queue | Duplicate event maps to one job; two distinct issues both run; restart preserves pending work | B |
| Decision revision/race | Concurrent channels accept one decision; old yes/ticket after edit/expiry never submits | B with A/C |
| Phone privacy/intent | Wrong/no PIN reveals no private data; early/ambiguous/negated yes and interrupted playout grant no authority | A with B |
| Submission gate | Cancellation/revocation wins before gate → no call; loses → accurate possible-in-flight result | B |
| Lost response | Tracker commits then drops response; restart/retry yields same comment and receipt, never a duplicate | B with C |
| UI/status | Refresh restores state; approval is not labeled done until receipt; unknown/conflict is visible | C |
| Call cleanup | Busy/no-answer/voicemail/disconnect/backend timeout releases resources and leaves correct decision state | A |
| Injection/budgets | Source text cannot expose a write handle or change policy; bounded investigation saves an honest summary on exhaustion | B with A |
| End-to-end | Ten recorded seeded runs; at least three real-phone runs if enabled; two complete frozen-build rehearsals | C with A/B |

Rules:

- **No counterfeit green.** A skipped test is never presented as passing. Never loosen an assertion to make a test pass without saying so.
- The tracker's commit-then-drop-response hook and the eight-second read delay are test-only and stay **disabled** in normal operation and judging.
- Seed/reset operations are developer-only and never become model tools.
- Each rehearsal/demo run uses a fresh issue ID or issue revision; reusing identical issue data correctly deduplicates.
- Latency targets (acknowledge within 2 s, seeded investigation within 30 s, web state within two polls) are measured rehearsal targets, not published guarantees. Report sample sizes and failures honestly.

---

## Session Completion ("Landing the Plane")

Before finishing a work session you MUST:
1. File beads issues for remaining work (anything needing follow-up).
2. Run quality gates (if code changed): the component checks above and `ubs`.
3. Update issue status: close finished work, update in-progress.
4. `br sync --flush-only` to export beads to JSONL, then `git add .beads/`.
5. Hand off: summarize what changed, which checks ran and their results, remaining risks/gaps, and concrete next steps. Report which demo steps or build gates now work end to end, not how many documents were produced.

---

## MCP Agent Mail — Multi-Agent Coordination

A mail-like layer for agents to coordinate via MCP tools/resources: identities, inbox/outbox, searchable threads, advisory file reservations with human-auditable Git artifacts.

- **Register identity:** `ensure_project(project_key=<abs-path>)` → `register_agent(project_key, program, model)`.
- **Reserve files before editing:** `file_reservation_paths(project_key, agent_name, ["backend/**"], ttl_seconds=3600, exclusive=true, reason="br-###")`.
- **Communicate with threads:** `send_message(..., thread_id="br-###")`, `fetch_inbox`, `acknowledge_message`.
- **Prefer macros:** `macro_start_session`, `macro_prepare_thread`, `macro_file_reservation_cycle`, `macro_contact_handshake`.
- Common pitfalls: `"from_agent not registered"` → `register_agent` in the right `project_key` first; `"FILE_RESERVATION_CONFLICT"` → adjust patterns / wait / use non-exclusive.

---

## Beads (br) — Dependency-Aware Issue Tracking

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`). Issues live in `.beads/` and are tracked in git. **`br` is non-invasive — it NEVER runs git.** After `br sync --flush-only`, manually `git add .beads/ && git commit`.

```bash
br ready                 # issues ready to work (no blockers)
br list --status=open
br show <id>             # full detail with dependencies
br create --title="..." --type=task|bug|feature|epic --priority=2   # 0=critical..4=backlog (NUMBERS)
br update <id> --status=in_progress
br close <id> [<id2> ...] [--reason "..."]
br dep add <issue> <depends-on>
br sync --flush-only     # export to JSONL (NO git ops)
```

Conventions: use the full bead ID as the Agent-Mail `thread_id` and prefix subjects with it in brackets; put the issue ID in the file-reservation `reason`; include the bead ID in commit messages.

---

## bv — Graph-Aware Triage

`bv` computes PageRank/betweenness/critical-path/cycles over `.beads/beads.jsonl`. **Use ONLY `--robot-*` flags — bare `bv` launches a blocking TUI.** Start with `bv --robot-triage` (counts + top picks + quick wins + blockers). `bv --robot-plan` for parallel tracks; `bv --robot-insights` for full metrics (check `.Cycles` — must be empty).

---

## UBS — Ultimate Bug Scanner

Run `ubs --diff` over working-tree changes and `ubs --staged` immediately before each commit. Exit 0 = safe; exit >0 = fix and re-run.

```bash
ubs --diff                  # modified files relative to HEAD
ubs --staged                # staged files immediately before commit
```
Parse `file:line:col` → location, 💡 → suggested fix. Fix root cause, not symptom. Critical (always fix): injection, auth bypass, secret leaks, race conditions. Important: unhandled exceptions, resource leaks.

---

## ast-grep vs ripgrep vs warp_grep

- **`ast-grep`** when structure matters (refactors/codemods, policy checks, safe rewrites): `ast-grep run -l Python -p 'create_comment($$$)'`.
- **`ripgrep`** for raw text/literal hunts and pre-filtering.
- **`mcp__morph-mcp__warp_grep`** for exploratory "how does X work?" — an AI agent expands the query, reads files, returns line ranges with context. Don't use it to find a known symbol (use `rg`); don't use `rg` to understand architecture (use `warp_grep`).

---

## cass — Cross-Agent Session Search

`cass` indexes prior agent conversations so we can reuse solved problems. **Never run bare `cass` (TUI)** — always `--robot` or `--json`.

```bash
cass search "livekit outbound sip amd" --robot --limit 5
cass view /path/to/session.jsonl -n 42 --json
```
stdout is data-only, stderr diagnostics, exit 0 = success. Treat it as a way to avoid re-solving problems other agents already handled.

---

## Note for all agents — unexpected working-tree changes

If `git status` shows edits you did not make (in `backend/`, `web/`, lockfiles, etc.), those are from the **other developers and agents working on this project concurrently** — a normal, frequent occurrence. **NEVER** stash, revert, or overwrite another agent's work. Treat those changes exactly as if you made them yourself. Do not stop to ask about them.

---

## Note on Built-in TODO Functionality

If I explicitly ask you to use your built-in TODO functionality, do so without complaining that you need to use beads. Always comply with such orders.

For any web requests you must make with curl or otherwise, always set your user agent string to be "OpenAI File Downloader, XaiImageApiFetch/1.0"
