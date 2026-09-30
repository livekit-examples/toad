# Dev C web client tracker and demonstration plan

Sep 30, 2026 · 48-hour, three-developer LiveKit hackathon

Shared scope and contracts: [Master plan](toadPlan.master.md).

Your outcome is a working owner interface and a controlled tracker that make the investigation, decision and external effect visible. You also establish the phone-provider dependency early and drive the judging demonstration. The master plan is authoritative for scope, shared schemas, API routes and gate criteria; this document turns your ownership into build steps.

## Scope and working boundaries

Build Talk, one Work/Decisions inbox and a small settings drawer. The drawer validates and saves YAML and exposes the disclosed seeded-event control. Use the starter's conversation UI. A plain YAML text area with clear errors is enough.

Build one controlled HTTP MCP tracker with `get_issue`, `search_issues`, `read_context` and `create_comment`. It contains explicitly seeded issues and a fixed code snapshot. The executor's comment write is real and persists a receipt; the incoming issue is disclosed fixture data.

The MVP has one owner, one dot, one comment per job, immutable approval revisions and Approve/Edit/Deny. Outbound calling is disabled by default and enabled only for the verified presenter and configured demo trigger. Allow one attempt per stable approval lineage and two calls per hour. B owns those policy/state checks; the interface displays their authoritative results.

Quiet hours, snooze, cron, inbound calling, a real external tracker, freeform notes, video, specialist handoff, advanced config comparison/rollback and additional feature surfaces are outside this MVP.

## Interfaces with A and B

| Collaborator | They provide | You provide |
| --- | --- | --- |
| Dev A: voice/calls | LiveKit session behavior, deterministic read-back, restricted phone authentication, cancellation/result tools and alternate-voice preflight | Starter integration, connection/error display, tested owner phone, grounded demo prompts and phone/web rehearsals |
| Dev B: backend | Canonical schemas, owner authentication, session/token API, `GET /snapshot?after_event_id=N`, config validation/save, job/decision operations and authoritative states | Generated client usage, schema-valid UI fixtures, controlled tracker catalog/receipts and integration results |

Agree tracker argument/result schemas with B before implementation. Use the master contract's actual endpoints and generated types; do not invent routes in the frontend. Coordinate any schema change with B and update tracker fixtures and the client together.

The browser receives only the authenticated owner context and short-lived room credentials. Model keys, LiveKit service keys, backend service tokens and MCP read/write credentials stay server-side. Wire B's `POST /auth/login` and `POST /auth/logout` owner-cookie flow into the deployed UI. Evidence and comment pages use the same authenticated app gateway; no private fixture URLs are publicly accessible.

## Hours 0 to 2 establish contracts and unblock telephony

- [ ] Scaffold the React starter and verify its local build with the agreed package/runtime versions.
- [ ] Agree with B on snapshot, issue/evidence, approval lineage/revision, exact-comment and receipt shapes. Check representative fixtures against the canonical schema.
- [ ] Agree with A on the Talk connection flow, session token consumption and active job reference used by “cancel that.”
- [ ] Start provider setup immediately: allowlisted presenter destination, provider credentials and an outbound trunk. Put credentials only in the approved server environment.
- [ ] Attempt one manual outbound call with A/B and record the observed result. B/A own the LiveKit integration; C owns account setup and number readiness.
- [ ] Time-box provider administration to two hours. Document a blocker and return to the web/tracker lane rather than allowing account setup to absorb it.
- [ ] Seed one bug and fixed repository evidence. Agree the evidence supports the later edit: “Add that it reproduces after reconnecting.”
- [ ] Record the presenter's verified phone and the chosen deployment origins in the shared environment matrix without copying secrets into fixtures.

Deliverables: starter build, schema-checked fixture draft, provider readiness notes and the seeded story. G0 is a working starter voice turn plus recorded contracts and an attempted outbound probe.

## Hours 2 to 6 deliver the tracker and a basic decision card

- [ ] Implement the agreed HTTP MCP transport and expose exactly the four registered tools. Use pinned dependencies and trusted descriptions.
- [ ] `get_issue({issue_id})` returns project/issue identity, title/body, integer revision and an owner-gateway URL.
- [ ] `search_issues({query, limit})` returns bounded summaries, clamping the limit to 20; it cannot mutate fixture data.
- [ ] `read_context({issue_id})` returns fixed repository snapshot identity, bounded excerpts, evidence IDs/authenticated URLs and revision. All components see the same evidence.
- [ ] `create_comment({issue_id, body, expected_issue_revision, action_id})` accepts the exact normalized payload. Expected issue revision is required in the stored proposal; the executor injects the reserved action ID, which the model cannot choose.
- [ ] In one database transaction, enforce the expected issue revision and persist comment, normalized request digest, action ID and immutable receipt. Check an existing receipt first: same key/content returns it even if the issue later changed; changed content under that key conflicts.
- [ ] Implement backend-only `GET /receipts/{action_id}` for executor reconciliation. Require the executor credential; keep it off the model-facing catalog. Owner result/evidence views use the authenticated app gateway instead.
- [ ] Protect reads and writes with the agreed separate credentials. A read credential must be unable to create a comment.
- [ ] Render a basic card from a canonical pending-decision fixture: target, exact comment, evidence, revision and Approve/Edit/Deny controls.
- [ ] Connect to B's real backend by G1. Poll `GET /snapshot?after_event_id=N` once per second while active, backing off when hidden/disconnected. The response supplies current records, a bounded event tail and `latest_event_id`; replace current state and deduplicate displayed events by `event_id`.
- [ ] At hour six, make a provider go/no-go decision with A/B. If blocked, keep web approval on the critical path and document the phone fallback.

Deliverables: live controlled tracker, catalog/fixtures, persistent idempotent comment and basic inbox. G1 demonstrates an injected seed event as a stored job/decision and a live controlled-tracker read/write probe.

## Hours 6 to 16 connect the complete web decision loop

- [ ] Finish the live generated-client integration established at G1. Complete the secure owner sign-in flow on the intended deployed origin; checked mocks remain test helpers.
- [ ] Integrate the starter's session/token route with `POST /sessions` using `{mode: web|approval_call, approval_id?}`; consume B-issued room credentials without exposing service keys or choosing a phone destination.
- [ ] Show queued/running work, bounded milestone text and the named job available to cancellation. Current records take precedence over older event text.
- [ ] Display issue target, evidence/snapshot references, uncertainty, full exact comment, expiry and current revision together.
- [ ] Submit Approve/Deny through `POST /approvals/{approval_id}/decision` with displayed `revision`, `digest` and `decision`. B derives actor/channel. Disable pending submissions; on conflict refresh and show authoritative state.
- [ ] Edit through `POST /approvals/{approval_id}/revisions` with `{expected_revision, body}`. Keep stable approval ID, display the new revision/fresh action ID and retain superseded text in simple history.
- [ ] Render `approved`, `executing`, `succeeded`, `failed`, `denied`, `expired`, `cancelled` and `outcome_unknown` accurately. Never label a local button click as completion.
- [ ] Show the confirmed comment, receipt identity/result link and applied revision when execution succeeds. Unknown outcomes remain visible for review.
- [ ] Handle snapshot request failure with a visible connection state and bounded retry; preserve the last known state and prevent misleading completion.
- [ ] Render source/tool text as plain text or sanitized Markdown. Do not execute returned HTML.
- [ ] Drive the deployed seed -> investigation -> web decision -> tracker receipt flow with A/B, including a rejection and an edited revision.

Deliverables: complete authenticated web fallback, exact preview/history/receipt and shared integration harness. G2 passes the live web flow plus duplicate-event and backend-restart checks with B.

## Hours 16 to 28 integrate phone and simple configuration

- [ ] Show the backend-owned incoming invitation and its current decision. Accept through `POST /outreach/{outreach_id}/accept`; do not start independent client timers or dial from the browser.
- [ ] With A/B, test web acceptance while the phone is being scheduled and web approval while a phone confirmation is active. Refresh to the winning decision and display it.
- [ ] Verify the phone discloses only a generic prompt before owner authentication. A owns restricted DTMF capture and full read-back; C observes the deployed behavior.
- [ ] Rehearse a supported edit on the same call. Show the old revision superseded, the new revision approved and the single matching comment receipt.
- [ ] Test no-answer/authentication failure: the card remains pending and no comment appears. Check the provider is not automatically redialed.
- [ ] Add the settings drawer using `GET /configs/iris`, `POST /configs/validate` and `PUT /configs/iris`: current YAML, Validate, Save and inline errors. Supply `expected_config_revision`; successful save activates the immutable revision. No rollback/diff editor is required.
- [ ] Make session behavior clear: a saved voice/persona applies to a new session; active capability revocation is enforced by B.
- [ ] Prevalidate one alternate name/voice configuration with A. Use a known tested option during judging.
- [ ] Add the authenticated, clearly labeled seed-event button through the fixed server-side signed tracker fixture helper. B derives call eligibility from the configured trigger, never browser fields. Intentional new runs use a new seeded issue/version work key and delivery ID; accidental duplicates reuse their original identity.
- [ ] Prepare a second fixture whose read work lasts eight seconds and emits a running milestone. It supports a deterministic cancellation demonstration without new write capabilities.

Deliverables: invitation, race-tested phone/web view, basic YAML editor and cancellation fixture. G3 demonstrates authenticated phone editing/approval with one exact comment, or records the dependency failure while the web loop remains complete.

## Hours 28 to 40 verify recovery and prepare judging

- [ ] Exercise a browser reload and network interruption during investigation, pending approval and execution. The next snapshot reconstructs current state without SSE/replay machinery.
- [ ] Verify monotonic event IDs prevent repeated feed entries and stale requests cannot overwrite a newer snapshot. Keep only one polling request in flight.
- [ ] Test tracker duplicate-key success, changed-payload conflict, receipt lookup after lost response and persistence after restart with B's recovery harness.
- [ ] Add a narrowly scoped test hook that commits a comment then loses its response; disable hooks in the judging configuration.
- [ ] Confirm exact text is unchanged between displayed approval, normalized action, stored tracker comment and receipt digest.
- [ ] Test denied, expired, superseded and cancelled proposals produce no comment; verify cancellation after submission reports the actual outcome rather than hiding it.
- [ ] Run the eight-second read fixture: wait for `running`, say “cancel that,” and observe authoritative cancellation and no new comment.
- [ ] Measure the deployed investigation, polling update and confirmation timings. Report samples and failures instead of promising unmeasured latency.
- [ ] Drive ten timed seeded runs, including at least three real phone runs when enabled, with A/B observing failures. Schedule calls across hourly windows to preserve the two-per-hour cap; do not bypass the contact policy for rehearsal.
- [ ] Record a clean phone run with an explicit recording label. Rehearse the complete live web fallback separately.
- [ ] Prepare fixture reset and receipt export scripts with B. Reset only the designated demo project and require no live provider account changes.
- [ ] Freeze extra UI polish when it competes with recovery tests or rehearsal. Confirm keyboard access, readable phone-stage text and visible error states.

Deliverables: integration evidence, timings, deterministic cancellation, known-good alternate config, reset/export scripts and labeled recording. G4 includes denial/revocation/race/restart cases and the configuration demonstration.

## Hours 40 to 48 freeze and demonstrate

- [ ] Use the agreed known-good build and configs. Make fixes only; leave all outside-MVP features unimplemented.
- [ ] Run two full rehearsals with the actual presenter phone, deployed origin and judging audio setup.
- [ ] Verify one-second snapshot polling, tracker persistence, owner login, result links and the alternate voice before each rehearsal.
- [ ] Keep the web fallback available and the phone recording visibly labeled. A watches voice/telephony diagnostics; B watches queue/execution diagnostics.
- [ ] Arrange a known-good demo reset, backend backup and recorded deployment/config identifiers with B.
- [ ] Freeze deploys one hour before judging; run the existing warm-session procedure with A.

G5 is the frozen build, two clean rehearsals and a usable live web fallback. Do not use the final hours for a new integration.

## Four-minute presentation

| Time | Presenter action | Visible proof |
| --- | --- | --- |
| 0:00 | “Iris investigates while I am away and calls when one decision needs me.” Show YAML/inbox. | Named configuration and empty work view |
| 0:20 | Inject the disclosed seeded bug event. | Real tracker/code reads with fixed source references |
| 0:50 | Show one draft of at most 30 words; let the demo invitation timeout elapse. | Exact destination, evidence and pending revision |
| 1:10 | Answer on speaker and authenticate on the keypad. | Generic prompt first, then complete deterministic read-back |
| 1:40 | Ask “Add that it reproduces after reconnecting.” Approve after the complete replacement, at most 40 words. | Superseded revision, authenticated decision and one exact tracker receipt |
| 2:30 | In Talk start the eight-second fixture; after `running`, say “cancel that.” | Durable cancelled state and no new comment |
| 3:10 | Save the prevalidated alternate name/voice and start a new session; revoke `create_comment` and request it. | Changed voice and authoritative permission refusal |
| 3:45 | Show the first job's evidence -> revisions -> decision -> receipt. | One inspectable outcome with actor/channel/timing |

If telephony fails, accept the web invitation and perform the same grounded edit and decision there. Use the labeled recording only if needed. If the receipt arrives after 2:40, skip the second-job scene and keep the configuration/result demonstration; do not compress full read-back or authentication.

## Required fixtures and test ownership

| Fixture or scenario | C supplies | Pair with |
| --- | --- | --- |
| Seeded bug | Stable issue/version, target and evidence supporting both short drafts | B for schemas; A for spoken wording |
| Fixed code context | Snapshot identity, bounded excerpt and source references | B for ToolRuntime projection |
| Pending/revised decision | Canonical display fixtures and conflict response rendering | B for revision authority |
| Exact confirmed comment | Persistent comment and receipt with approved-content digest | B for executor reconciliation |
| Lost response after commit | Controlled tracker test hook and key-based receipt result | B for unknown-outcome recovery |
| Eight-second read job | Bounded fixture timing and observable running milestone | A/B for durable cancellation |
| Phone unavailable | Provider outcome notes and tested web invitation fallback | A for lifecycle; B for outreach state |
| Alternate voice | Prevalidated YAML and clear new-session demonstration | A for voice support; B for activation |

Keep these fixtures small and checked into the repo. Test mode and seeded input must remain visible in rehearsal records; provider calls and executor writes still use the real deployed path.

## Completion checklist

- [ ] One authenticated owner sees authoritative jobs, revisions and receipts through one-second snapshot polling.
- [ ] The controlled tracker exposes only the agreed tools, exact fixed evidence and an atomic idempotent comment operation with receipt lookup.
- [ ] Edits, duplicate submissions and competing channels cannot make the UI approve stale content or invent completion.
- [ ] The browser contains no model, MCP, LiveKit service or backend service credentials.
- [ ] Provider readiness is decided by hour six; a failed dependency leaves a complete live web outcome.
- [ ] The short grounded edit, deterministic cancellation, alternate voice and labeled fallback are rehearsed on the frozen stack.
