# Dev B backend and durable execution plan

Sep 30, 2026 · 48-hour MVP · one owner, one dot

Shared scope and contracts: [Master plan](toadPlan.master.md).

Use [the final master plan](toadPlan.master.md) and checked shared contracts as authority. This plan organizes Dev B's work; it does not introduce additional features or alternate API payloads. Coordinate contract changes with Dev A and Dev C before merging them.

## Ownership and finished result

Dev B owns the public HTTPS backend, canonical schemas/contracts, owner login and agent-session binding, config validation, ToolRuntime, worker, SQLite store, approval revisions, executor and persisted outreach. The backend is one deployed application, one replica and one Uvicorn worker with a persistent local volume.

The finished slice accepts a signed or authenticated seeded issue event, investigates through three permitted reads, stores one proposed comment, accepts one authenticated decision, submits exactly that revision through the executor and records a verified receipt. Closing a room or restarting the backend must not lose the work or silently duplicate a comment.

Dev A owns voice/model setup, DTMF collection, complete read-back and SIP lifecycle. Dev C owns the controlled HTTP MCP tracker, its atomic idempotent comment/receipt contract, web login/inbox/settings UI and rehearsal fixtures. B supplies their backend interfaces and enforces authority.

## Scope boundary

- Three registered reads: `tracker/get_issue`, `tracker/search_issues`, `tracker/read_context`; one proposed mutation: `tracker/create_comment`.
- Webhook, authenticated manual/demo and voice delegation start durable jobs. One proposal per job.
- Backend-owned ToolRuntime is the only MCP client. The agent has no MCP credentials, arbitrary endpoint access or write handles.
- One immutable `config_revision` per job/session. Name, persona, voice/model changes apply on the next session; both snapshot and current policy must permit a capability. Revocation blocks future reads and writes; a submitted effect cannot be recalled.
- One persisted web-to-phone outreach attempt per approval lineage, enabled only after the trunk readiness gate and validated demo opt-in. Only the configured seeded trigger grants call eligibility; routine/manual delegated work stays in the inbox. Enforce the global two-calls-per-hour cap.
- Authoritative bounded snapshots: active web polls every second and backs off when hidden/disconnected; the agent follows jobs every two seconds while connected. Events have monotonic IDs and a limited tail; no SSE or replay service.
- No cron, real tracker, stdio/filesystem tools, notes, inbound calls, quiet hours, snooze, roles engine or rollback UI in this MVP.

## Contracts and durable records

Own `shared/`, checked schemas/OpenAPI and backend fixtures. Generate the TypeScript client/types for C and provide a small Python client contract for A. All three use the same valid/invalid fixtures. Final field names and request bodies come from these checked contracts.

Record the following concepts with foreign keys, uniqueness constraints and indexed queue/state fields:

| Record | Required identity or durable fact |
| --- | --- |
| Config revision | Immutable `config_revision`; active snapshot; trusted connector/schema identity; successful save activates it |
| Trigger delivery | Source plus unique delivery ID; normalized resource/version/context |
| Job | Immutable config revision, work/request key, state, context, lease, budgets and cancellation |
| Approval lineage/revision | Stable `approval_id`; immutable `(approval_id, revision)`; new `action_id` for each revision; envelope/digest and expiry |
| Execution attempt | Reserved executor-supplied `action_id`; claim/attempt; `submission_started_at`; confirmed or unknown outcome; receipt |
| Outreach | Stable lineage, current revision, deadline, claim/attempt, room/dispatch references and outcome |
| Session | `session_id`, owner/room/config binding, auth state/expiry and spoken event cursor |
| Event | Monotonic `event_id`, typed bounded payload and correlation IDs |

Approval rows are the durable execution queue; outreach rows are the durable contact queue. Commit their state/work intent and corresponding event together. Do not introduce a generic outbox framework.

Keep approval lineage identity stable through edits. Supersede the old revision, create a new action ID and require a new read-back ticket. Preserve the existing authenticated phone session and the lineage's call-attempt count.

Bounded API families below identify ownership, not a competing payload specification:

| Routes or operations | Contract purpose |
| --- | --- |
| `POST /auth/login`, `POST /auth/logout`; `/health`, `/ready` | Secure owner session; deployment and recovery status |
| `POST /sessions`, `GET /sessions/{session_id}` | Backend-created room/dispatch, short-lived browser token, agent lookup |
| `POST /sessions/{session_id}/phone-auth` | Restricted DTMF verification and session/lineage capability |
| `POST /sessions/{session_id}/delivery-cursor` | Monotonic spoken-result acknowledgement after complete playout |
| `POST /tools/read` | Qualified registered read, validated arguments and snapshot/current scope |
| `POST /jobs`, `POST /jobs/{job_id}/cancel` | Durable work with `Idempotency-Key`; cancel with `expected_version` |
| `POST /hooks/tracker`; authenticated fixture job helper | HMAC over raw body, delivery deduplication and commit-before-ACK; eligibility comes from the profile |
| `POST /approvals`; `POST /approvals/{approval_id}/revisions`, `/readback`, `/decision` | Immutable proposal, `expected_revision` edit, revision/digest ticket and conditional decision |
| `POST /outreach/{outreach_id}/accept`, `POST /outreach/{outreach_id}/status` | Conditional browser claim and bound-agent lifecycle reports |
| `GET /snapshot?after_event_id=N` | Current bounded records plus newer event tail and `latest_event_id` |
| `GET /configs/iris`, `POST /configs/validate`, `PUT /configs/iris` | Strict YAML and `expected_config_revision`; successful save activates an immutable revision |

Return consistent machine-readable errors, including conflict/current revision and correlation ID when applicable. Request keys are scoped to caller/operation; the same key with different content is a conflict. Never trust model-supplied owner, endpoint, account or phone fields as authority.

## Invariants to implement first

1. Only the executor's internal mutation path can call `tracker/create_comment`. ToolRuntime rejects unregistered or hidden tool references even when guessed.
2. Reads/proposals require both pinned snapshot and current permission plus validated target scope. Execution checks active policy, connector identity and schema again at the submission gate.
3. An approval authorizes one normalized, immutable action envelope. Preview, complete voice read-back, digest, decision and submitted content refer to the same revision. Stored arguments require `issue_id`, `body` and `expected_issue_revision`; B supplies the reserved `action_id`, which the model cannot select. All contribute to the approved digest.
4. The decision is an atomic conditional `pending → approved|denied` transition. Stale revisions, competing channels and duplicate clicks cannot produce a second accepted decision.
5. Executor claims, cancellation and the submission gate coordinate through database conditional updates. Before the gate wins, cancellation prevents the call. Once submission intent wins, report that the write may be in flight; do not promise cancellation.
6. Persist `submission_started_at` and the attempt before the network call. Check cancellation/current policy in the same gate transaction. Network calls occur outside database transactions. C checks receipt existence first on retries and validates the issue/evidence revision atomically with a new comment write.
7. A remote timeout or restart after possible submission is `outcome_unknown`. Reconcile through C's backend-only `GET /receipts/{action_id}`; retry only under that adapter's idempotency guarantee and valid authority. A stale issue returns for fresh investigation/review.
8. Jobs, approval execution intent, outreach contact intent and corresponding events commit atomically. In-memory asyncio tasks are conveniences; restart reads these queue records.
9. A phone session before verification receives only authentication setup/status. Private tool/job/approval reads, proposals, edits, cancellation and decisions require the verified owner capability. Worker service reads remain independent of phone presence.
10. Internal jobs/events/proposal writes are permitted; external effects need approval. Logs/events contain no PIN, credential or raw secret-bearing request.

## Hours 0 to 2 establish the shared slice

- [ ] Deploy a minimal public HTTPS backend with health checks immediately; choose one persistent-volume host and record its URL for A/C.
- [ ] Agree the config, job, action/revision, session, snapshot and tracker idempotency/receipt contracts with A/C. Commit checked schemas and fixtures.
- [ ] Create migrations and a bounded DB access layer. Enable foreign keys, WAL and a busy timeout; keep all transactions short.
- [ ] Implement one-owner secure session login. Use server-side secrets, secure HttpOnly cookies, mutation origin/CSRF checks and strict allowed origins.
- [ ] Establish agent service authentication and backend-created session/room binding; the browser receives only short-lived room tokens.
- [ ] Stub the agreed routes from validated fixtures so A/C can build independently. Record environment ownership without secret values.

**Outputs:** public health URL; initial migration; shared schemas/OpenAPI; validated fixtures/mock backend; environment/compatibility matrix.

**Gate/dependencies:** A confirms a session lookup against the public backend. C confirms login and can render the fixture snapshot. C publishes the three-read/one-write tracker contract; B does not wait for a real integration.

## Hours 2 to 6 persist intake and authority

- [ ] Finish signed raw-body webhook verification, payload limits and delivery-ID deduplication. ACK only after the normalized event/job commits.
- [ ] Add authenticated manual/demo ingestion and delegation `Idempotency-Key`; reject changed content under a reused key. Never derive phone eligibility from client/model fields.
- [ ] Queue two distinct issue events without dropping either. Enforce a bounded queue with a retryable overload response.
- [ ] Implement strict config validation against fixed connector/schema definitions; reject unknown keys/tools, overlaps, arbitrary endpoints and scope expansion.
- [ ] Implement pending immutable proposals, exact normalized previews and revision-aware web decisions using the fixture worker.
- [ ] Add atomic state/event writes and durable approval/outreach queue records; read current state and `latest_event_id` in one short transaction. Return ordered pending final results independently of the capped activity tail; filter phone data to its verified bound lineage/job.
- [ ] Wire ToolRuntime to C's live tracker; prove read credentials cannot invoke the write path and that executor credentials remain backend-only.

**Outputs:** live intake/job/config/decision/snapshot APIs; policy-denial checks; tracker read and idempotent test-comment probe; deployment with persistent DB.

**Gate/dependencies:** seeded input persists as one job/proposal and appears in C's inbox. A/C declare phone provider go/no-go by hour six; phone failure does not block the backend/web slice.

## Hours 6 to 16 complete investigation and web execution

- [ ] Implement the bounded worker using one tested tool-capable provider client. Preserve matching tool calls/results; label issue/code output as untrusted data. Worker/voice proposal races must conditionally create only one approval lineage for the bound running job.
- [ ] Reuse MCP connections; allow at most two independent read calls together. Apply per-call timeout, output-size limit and source/version retention.
- [ ] Persist job leases, attempts, deadline and token/tool budgets. A no-action grounded result completes the job directly; one valid proposal waits for its action outcome.
- [ ] Implement revision CAS decisions, expiry, supersession and cancellation of unsubmitted actions.
- [ ] Implement the executor claim and atomic submission gate. Inject reserved `action_id` into the stored `create_comment` call with `expected_issue_revision`; store the applied-content receipt before reporting success.
- [ ] Add startup recovery for interrupted reads, queued approved work and uncertain writes. Reconcile possible submissions rather than using read-job retry rules.
- [ ] Integrate A's live read/delegate/propose client and C's real approval/receipt UI. Replace fixture-only execution with the actual tracker call.

**Outputs:** real investigation → web decision → confirmed comment; exact revision/content receipt; restart/response-loss hooks; tested state transitions.

**Gate:** G2 passes on the deployed stack: live investigation → web decision → exact verified comment; duplicate event/decision causes one result and restart preserves durable work. Denied/revoked actions never cross the submission gate.

## Hours 16 to 28 add one authenticated phone attempt

- [ ] Persist web invitation deadline and one phone-attempt allowance per lineage. Keep approval state separate from outreach outcome.
- [ ] Implement conditional accept/escalation claims and store known room/dispatch IDs before external dispatch. Reconcile an ambiguous dispatch against those IDs.
- [ ] Enable automatic phone dispatch only after A/C's manual trunk test and validated demo profile. Resolve the fixed verified owner destination server-side; enforce one attempt per lineage and two calls per hour.
- [ ] Add restricted PIN-hash verification, limited attempts and short-lived session/lineage authority. Redact digit inputs; expose no private context before successful verification.
- [ ] Implement revision/digest-bound read-back tickets. Accept completion only from A's bound adapter after full playout; interrupt/disconnect invalidates it.
- [ ] Implement monotonic `/sessions/{session_id}/delivery-cursor` updates only after complete spoken-result playout; interruption does not acknowledge delivery and an older pending final result cannot be skipped.
- [ ] Preserve the call/authentication through an owner edit, transfer the confirmation lease to the replacement revision and require a fresh ticket.
- [ ] Stop/cancel competing outreach when a decision wins. Busy/no-answer/auth failure updates contact outcome while the approval stays pending.
- [ ] Exercise C's commit-then-drop-response fault and restart before result persistence; reconcile `GET /receipts/{action_id}` to the original comment and never duplicate it.

**Outputs:** persisted web-to-phone path; bound phone verification/read-back/decision APIs; race and stale-ticket tests; startup outreach reconciliation.

**Gate/dependencies:** G3 is an authenticated phone edit → fresh complete read-back → exact receipt; failures leave the inbox pending. A supplies DTMF/playout and SIP outcomes; C proves browser/phone races and lost-response recovery with B. If phone remains blocked, retain the complete web path.

## Hours 28 to 40 harden the narrow path

- [ ] Test cancellation while queued, reading, awaiting approval and before/after submission intent. Return the authoritative accepted/too-late outcome.
- [ ] Test read/write capability revocation against existing jobs/sessions and queued approved actions. Name/voice save changes only the next session; validate C's 30-word draft/40-word edited-comment demo profile and alternate voice before judging.
- [ ] Test restart during lease ownership, dispatch and possible write submission. Resolve orphaned resources using persisted IDs, not blind retries.
- [ ] Bound snapshot/event-tail sizes and verify one-second web/two-second agent polling does not hold DB transactions open.
- [ ] Surface unresolved recovery through readiness/snapshot status. Record correlation IDs, budget usage and honest execution state.
- [ ] Create consistent DB backup/restore and reset procedures with C; verify restore against tracker receipts to avoid reissuing applied actions.
- [ ] Run the deterministic suite and assist C's ten measured seeded runs. Fix correctness/latency failures; add no feature surface.

**Outputs:** passing fault/race tests; backup/restore/reset instructions; readiness diagnostics; measured run results; known-good config/build.

**Gate:** denial, edit, revocation, cancellation, competing channels and crash scenarios pass. A/C can explain the evidence → revision → authenticated decision → receipt chain from authoritative records.

## Hours 40 to 48 freeze and rehearse

- [ ] Freeze feature work; resolve only demonstrated failures. Record known-good commit, config revision, migrations and deployment settings.
- [ ] Back up consistent backend/tracker state and verify the clean demo reset. Ensure fault-injection hooks are disabled.
- [ ] Run two complete rehearsals with A/C, including the live phone when enabled and the full web fallback.
- [ ] Freeze deploys one hour before judging; watch readiness and unresolved recovery while C presents.

**Outputs:** frozen deploy, checked runbook, recoverable data, clean seed state and two recorded rehearsal outcomes.

## Deterministic test matrix

| Scenario | Required assertion |
| --- | --- |
| Duplicate delivery/request; changed body under same key | One job for a retry; changed intent conflicts; distinct issues remain queued |
| Hidden tool, invalid schema/target, revoked capability | Runtime refuses; no external mutation is dispatched; grants require a fresh snapshot |
| Concurrent approve/deny, double click, stale revision | One accepted decision; authoritative conflict/current state returned |
| Edit or interrupted/early read-back; unverified phone | Old ticket cannot decide; no private API data before owner verification |
| Cancellation versus submission gate | Exactly one gate wins; accepted cancellation means no external call |
| Tracker commits then drops response; restart before receipt save | Existing action-key receipt reconciles; exactly one approved comment exists |
| Same action key with changed content | Tracker/runtime rejects the mismatch; no silent replacement |
| Issue changes before submission; receipt exists on retry | Fresh stale write is refused; an already committed action returns its original receipt first |
| Restart, expired lease, failed/ambiguous dispatch | Durable work remains; known IDs reconcile; no blind second phone attempt |
| Expiry, no-action finish, confirmed failure, unknown result | Jobs/decisions reach accurate states; no false success or perpetual waiter |

## Definition of done

B's work is done when the deployed backend passes the matrix, A/C use checked contracts against it, and the master plan's demo completes through one verified receipt. Exact approved bytes match the tracker result; cancellation/revocation before submission intent prevents the effect; uncertain outcomes remain visible and recoverable. Restart preserves records, phone details require verified authority, secrets stay server-side, and the frozen runbook/backup/web fallback work without adding infrastructure or features outside this MVP.
