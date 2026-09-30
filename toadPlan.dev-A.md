# Dev A voice agent and outbound approval calls

September 30, 2026 · 48-hour MVP implementation plan

Shared scope and contracts: [Master plan](toadPlan.master.md).

The [master plan](toadPlan.master.md) is the scope and contract authority. This plan implements Dev A's lane; shared route or schema changes must land in B's contracts and both clients together.

Own the LiveKit conversation adapter from session lookup through deterministic confirmation and call cleanup. The backend owns work, permissions, decisions, contact arbitration and external execution. The agent holds voice-provider and backend-service credentials; it holds no MCP credentials or external write handles.

Ship one owner, one assistant, browser voice/text and one allowlisted outbound destination. A job may produce one external `create_comment` action. The complete fallback is authenticated web approval with the same immutable action revision and executor.

## Scope and handoff

Your deliverables are the agent entrypoint, typed backend client, six core tools, confirmation controller, restricted DTMF collector, outbound lifecycle, agent tests, deployed image and operational runbook.

Do not build cron, inbound calls, real tracker integration, stdio tools, freeform notes, specialist handoffs, SSE, quiet hours, snooze or config rollback UI. C's active web view polls every second; your following agent polls every two seconds. The backend remains authoritative after a call ends.

| Dependency | Owner | What you need |
| --- | --- | --- |
| Shared schemas and session/API contracts | B | Config/session lookup, role checks, jobs, action revisions, read-back completion, decisions, phone verification and contact outcomes |
| Durable work, ToolRuntime and executor | B | Idempotent submission, authoritative status, target/text previews and verified/unknown execution results |
| Web session and exact decision preview | C, with B | Room connection, owner identity and displayed revision matching spoken confirmation |
| Demo tracker and fixture evidence | C | Fixed tool schemas, short comment example and receipts for testing |
| SIP account/trunk and verified owner number | C | A successful manual outbound call and account-specific dialing constraints |

B owns the canonical schemas and master-plan routes. Use generated/shared types rather than independently inventing a second API. Return contract problems with a minimal failing fixture so B can fix backend and mock together. Pending approval/outreach rows are B's durable queues; no generic outbox is required.

## Hours 0 to 2 prove the installed voice path

- [ ] Scaffold the Python starter and explicitly set dispatch name `dot-agent`.
- [ ] Record exact Agents, provider-plugin and CLI versions plus starter commit. Commit the lockfile after the compatibility probe.
- [ ] Verify one local voice turn and one browser voice/text turn. Record the exact working development and dispatch commands.
- [ ] Confirm `AgentSession`, session-scoped `AsyncToolset`, foreground handling, speech playout completion, interruption events, AMD and SIP DTMF events on the installed stack.
- [ ] Agree B's session metadata envelope and `GET /sessions/{session_id}`: opaque session/config references, room binding and no caller-supplied destination or private action body. C obtains browser sessions through owner-authenticated `POST /sessions`.
- [ ] Agree the tool catalog and typed fixtures with B/C. Keep the model-facing catalog small.
- [ ] Provision agent backend-service and voice-provider credentials. Cloud supplies its LiveKit runtime credentials; local development needs separate settings.
- [ ] Implement an explicit development-only fallback config. Missing or malformed deployed session metadata must fail closed.

Deliver: starter voice turn, committed version record, shared contract fixtures and a backend-client skeleton. Keep credential values out of fixtures, logs and dispatch metadata.

Gate A0: B/C can dispatch the named agent and hear a turn; a deployed job with invalid metadata cannot silently load local defaults. C has attempted the manual outbound call.

## Hours 2 to 6 build the facade and phone startup probe

- [ ] Build a typed async backend client with bounded connection/request timeouts, correlation IDs and sanitized errors.
- [ ] Bind every request to B's issued session. A model argument cannot change owner, account, endpoint, room or destination authority.
- [ ] Add core tools through a session-scoped `AsyncToolset`: `call_read_tool`, `delegate`, `list_background_jobs`, `cancel_background_job`, `propose_action`, `get_decision`.
- [ ] Keep agent-level tool declarations from accidentally replacing the session catalog. Assert the effective catalog at startup.
- [ ] Map reads to `POST /tools/read`; delegation to `POST /jobs` with `Idempotency-Key`; status tools to scoped `GET /snapshot?after_event_id=N`; cancellation to `POST /jobs/{job_id}/cancel` with `expected_version`.
- [ ] Map `propose_action` to `POST /approvals` with a stable request key. Its model schema exposes issue ID, body and expected issue revision; B constructs/injects trusted action identity. No direct tracker mutation tool exists.
- [ ] Give `delegate` an immediate acknowledgement before network work. Obtain its request identity from adapter/backend context, not an LLM-chosen authorization field.
- [ ] Exercise the tools against B's fixtures. Keep request/result pairing and error outputs valid for the selected model. By hour six, complete a real deployed session lookup/read probe with B; mocks remain failure-test helpers.
- [ ] Probe outbound startup: connect room, attach/start session audio, suppress the ordinary greeting, arm AMD for the intended SIP identity, then dial.
- [ ] Disable automatic IVR navigation. Verify a real pickup and a voicemail test when C's provider is ready.
- [ ] Verify the restricted keypad DTMF event path. Do not substitute an LLM tool or spoken-digit collector for it.

Deliver: working tool facade, startup catalog assertion and a phone startup trace showing detector readiness before SIP audio arrives.

Gate A1: fixtures drive each core operation and the deployed lookup/read probe passes, with no MCP secret in the agent. A guessed write/read capability is denied by B. Record phone go/no-go with B/C by hour six; a blocked trunk does not delay web integration.

## Hours 6 to 16 complete the browser conversation and approval path

- [ ] Switch from fixtures to B's deployed HTTPS backend; retain fixture tests for failures.
- [ ] Follow a delegated job through `GET /snapshot?after_event_id=N`, with an immediate snapshot and polling every two seconds while connected. Current records restore state even if the bounded event tail was missed. Stop following on disconnect or terminal status.
- [ ] Coalesce voice milestones to at most one every five seconds. Do not speak raw tool JSON or repeat unchanged snapshots.
- [ ] Queue final results by event ID and acknowledge `POST /sessions/{session_id}/delivery-cursor` only after complete result playout. Do not advance past an older undelivered result; interruption leaves its cursor unacknowledged. Reconnect reads current backend state; uncertain speech delivery is not universal exactly-once speech.
- [ ] Make cancellation target the discussed durable job ID. Stopping a local waiter only stops following; `cancel_background_job` requests backend cancellation with the observed job version.
- [ ] Implement deterministic confirmation from B's normalized target and exact complete comment text.
- [ ] Hold confirmation in the verified foreground mechanism. Queue/coalesce other progress while confirmation owns speech.
- [ ] Use `POST /approvals/{approval_id}/readback` for start/complete/interrupt phases and its ticket. Ask for approval only after complete target/text playout; completion binds revision, digest and session.
- [ ] Clear completion on interruption/disconnect. An early, ambiguous or negated yes never becomes an accepted decision.
- [ ] Submit `POST /approvals/{approval_id}/decision` with revision, digest, explicit approve/deny and voice ticket. B derives actor/channel. On 409 fetch current state; do not resubmit an old revision.
- [ ] Edit through `POST /approvals/{approval_id}/revisions` with `expected_revision` and body. It preserves `approval_id`, creates a fresh revision/action, transfers the active lease and invalidates old read-back; require full new playout.
- [ ] Report a verified executor result or B's actual pending/executing/unknown state. Limit in-call result waiting to 30 seconds.

Deliver: browser voice investigation → proposal → full read-back → accepted revision → exact tracker comment receipt, using C's live tracker and B's executor.

Gate A2: an interrupted read-back cannot authorize execution; editing cannot reuse the old ticket; denial produces no comment. Ending the conversation does not terminate B's durable investigation.

## Hours 16 to 28 authenticate and complete the outbound call

- [ ] Accept only B's claimed outreach attempt bound to the immutable approval lineage and known room. The model cannot initiate arbitrary dialing. Calling is disabled by default; only the configured demo-trigger profile enables it.
- [ ] Resolve the fixed owner destination through B's trusted configuration. B enforces outbound opt-in, hourly cap and one persisted attempt per approval lineage, including edits.
- [ ] Initialize audio/session and AMD before `CreateSIPParticipant`; set the intended participant identity and `wait_until_answered=True`.
- [ ] Bound dial, participant attachment, detection and authentication waits with application deadlines. Do not wait indefinitely for the callee to speak first.
- [ ] Treat machine/IVR/unavailable outcomes as hangup without private details. Human/uncertain outcomes permit only the generic identity/authentication prompt.
- [ ] Before PIN verification run an auth-only phone state: expose no private core tools/context. B permits only generic session lookup, phone verification and contact status/cleanup, and denies snapshots, reads, jobs, approvals, edits and cancellation.
- [ ] Collect keypad events outside model input, transcript and ordinary logs. Send digits only to `POST /sessions/{session_id}/phone-auth` over HTTPS.
- [ ] B verifies its stored PIN hash with attempt/rate limits; use at most three attempts and a 30-second authentication window.
- [ ] Private retrieval, ToolRuntime reads and decisions require B's short-lived owner capability bound to this phone session and approval lineage.
- [ ] After authentication, fetch the current revision and run the same deterministic confirmation used in web voice.
- [ ] Reuse owner authentication for an edit within the same live lineage/session; invalidate old read-back. Do not redial or reset the global attempt allowance.
- [ ] Observe B's arbitration while dialing/confirming. A web decision that wins makes this voice decision stale; stop the confirmation and clean up.
- [ ] Configure normal end-call behavior explicitly. Use idempotent cleanup for ordinary hangup, disconnect, timeout and exception; report references/outcome through `POST /outreach/{outreach_id}/status` without changing an unresolved approval to denied.

Deliver: real outbound call with generic greeting → keypad verification → private read-back → edit → new full read-back → approved exact comment → receipt → clean hangup.

Gate A3: wrong/no PIN and voicemail disclose no private issue text and produce no write. Concurrent web approval wins only once. The edited phone call remains one outreach attempt and one approval lineage.

## Hours 28 to 40 prove failures and tune speech

- [ ] Run the deterministic tests below against B's provider fake and canonical fixtures.
- [ ] Test HTTP timeout/disconnect at each confirmation stage. Recover status from B; never guess that a timeout means denial or execution failure.
- [ ] Verify two delegated jobs have distinct IDs and summaries. Cancelling one cannot cancel the other.
- [ ] Test a completed job arriving during read-back. It must not interrupt the target/text or invalidate which question the user answers.
- [ ] Verify the selected voice renders the complete short comment clearly. Unsupported/rich/overlength content stays in web approval.
- [ ] Measure end-of-turn acknowledgement, read-back duration, pickup-to-auth prompt and approved-to-result timing on the deployed stack.
- [ ] Join C's ten timed seeded runs; use at least three real phone runs when the provider gate passed. Record failures and actual timings.
- [ ] Prevalidate the alternate name/voice config; show that new sessions adopt it while current policy revocation still takes effect immediately.
- [ ] Record agent recovery instructions: logs, known-good version/config, allowed rollback path and room cleanup verification.

Deliver: passing failure scenarios, measured timings, known-good alternate voice and the phone segment for C's fallback recording.

Gate A4: no private disclosure before auth, stale/partial voice consent cannot execute, durable cancellation is correctly targeted, and every phone outcome releases its resources.

## Hours 40 to 48 freeze and rehearse

- [ ] Freeze features at hour 40. Fix correctness, integration and demo blockers only.
- [ ] Deploy the locked known-good build. Re-run one browser turn and one approved comment after any repair.
- [ ] Check the actual Cloud plan: staging/instant rollback availability and cold-start behavior. Do not rely on unsupported project features.
- [ ] If agents sleep when idle, keep a verified warm session active through demo start. A closed warm-up may sleep again.
- [ ] Keep logs and B's correlation IDs visible to A/B during judging; avoid exposing private credentials or PINs.
- [ ] Rehearse pickup, keypad input, complete read-back, edit and approval with C presenting on the actual phone.
- [ ] Run two complete rehearsals of the frozen stack, including the authenticated web fallback.
- [ ] Freeze deployments one hour before judging. Keep the known-good redeploy command and labeled fallback recording ready.

Deliver: final deployed voice build, version/config identifiers, concise recovery runbook and two clean full rehearsals with B/C.

Gate A5: C can perform the full story without an engineer changing code/config mid-run, and can switch to web approval when telephony fails.

## Required tests and their assertions

| Scenario | Exact assertion |
| --- | --- |
| Invalid/stale deployed session reference | Agent fails closed; no local default, private read or arbitrary dispatch |
| Effective tool catalog | Six intended core tools plus explicitly configured normal end-call helper; no MCP/write handle |
| Delegation acknowledgement | Acknowledgement starts before delayed backend submission completes |
| Polling and disconnect | One follower polls at two-second intervals; current records recover missed event tails; unchanged snapshots are silent; disconnect stops follower only |
| Spoken delivery cursor | A completed result advances B's session cursor after playout; interruption does not acknowledge it; a later result cannot skip an older undelivered result |
| Duplicate request or transient response loss | B returns/reconciles the existing request; agent does not create an unrelated second job/action |
| Complete read-back | Spoken approval payload equals B's normalized target and full text; completed ticket is recorded only after playout |
| Interruption, early yes, negation or timeout | No valid voice decision is submitted; pending/expired state comes from B |
| Edit during confirmation | Same approval lineage, new revision/action; old completion invalid; replacement receives complete read-back |
| Concurrent web/phone decisions | One B-accepted decision/effect; losing voice request reports current state and releases the room |
| DTMF verification | Spoken digits do not authenticate; wrong/missing keypad input grants no owner capability |
| PIN privacy | Captured digits absent from model context, transcripts, activity events and ordinary logs |
| AMD or authentication failure | No private issue/comment retrieval or speech; no decision/write; persisted attempt recorded and room released |
| Result timeout or uncertain remote outcome | Agent reports B's authoritative pending/executing/unknown status, never fabricated success/failure |
| Local versus durable cancellation | Waiter cancellation preserves B's job; named `cancel_background_job` with current version cancels only requested unsubmitted work; after submission gate it reports possible in-flight execution |
| Progress during confirmation | Milestones cannot land inside the complete read-back/prompt exchange |
| Call termination failures | Cleanup safely repeats; normal/error/disconnect paths leave no active SIP participant/session |

Use pytest with controllable backend/speech fakes for deterministic authority and playout tests. Use the pinned CLI debugger when verified for conversational traces; real calls validate audio/DTMF/AMD behavior. Check effects and state rather than demanding one exact model tool-call sequence.

## Final handoff to Dev B and Dev C

Provide the agent version, config revision, verified CLI commands, session/tool contract fixtures, test results, measured phone timings and remaining known limitations. B owns final decision/execution correctness; C owns the displayed preview, provider configuration and presenter flow. Any phone failure must still leave a useful, authenticated web decision with the same current revision.
