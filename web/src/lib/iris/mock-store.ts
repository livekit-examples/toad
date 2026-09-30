// In-memory stand-in for B's backend, used by the /api/mock routes. It follows the plan's rules
// (revision/digest checks, fresh action IDs on edit, expiry, approve -> executing -> succeeded with a
// receipt) so the UI can be exercised end to end. Server-only; state resets when the process restarts.
import { createHash, randomUUID } from "node:crypto";
import { buildFixtures } from "./fixtures";
import type { Approval, DecisionRequest, IrisEvent, Job, RevisionRequest, Snapshot } from "./types";

const EVENT_TAIL = 50;
const MAX_BODY = 2000;
// Delays for the simulated executor after an approval.
const EXECUTING_AFTER_MS = 1500;
const SUCCEEDED_AFTER_MS = 4000;
const OWNER = "owner@toad.test";

type Transition = { at: number; approvalId: string; to: "executing" | "succeeded" };

type State = {
  jobs: Map<string, Job>;
  approvals: Map<string, Approval>;
  events: IrisEvent[];
  nextEventId: number;
  transitions: Transition[];
};

export class MockError extends Error {
  constructor(public readonly status: 400 | 404 | 409, message: string, public readonly current?: Approval) {
    super(message);
  }
}

function digestOf(a: Pick<Approval, "target" | "body" | "action_id">) {
  const normalized = JSON.stringify({
    project: a.target.project,
    issue_id: a.target.issue_id,
    issue_revision: a.target.issue_revision,
    action_id: a.action_id,
    body: a.body,
  });
  return `sha256:${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

function normalizeBody(body: string) {
  return body.replace(/\r\n?/g, "\n").trim();
}

function seed(): State {
  const now = Date.now();
  const fixtures = buildFixtures(now);
  const approvals = new Map<string, Approval>();
  for (const a of fixtures.approvals) {
    const digest = digestOf(a);
    approvals.set(a.approval_id, { ...a, digest, receipt: a.receipt && { ...a.receipt, digest } });
  }
  const events = fixtures.events.map((e, i) => ({ ...e, event_id: i + 1 }));
  return {
    jobs: new Map(fixtures.jobs.map((j) => [j.job_id, j])),
    approvals,
    events,
    nextEventId: events.length + 1,
    transitions: [],
  };
}

// Keep state on globalThis so dev-mode module reloads don't wipe it.
const g = globalThis as typeof globalThis & { __irisMock?: State };
const state = () => (g.__irisMock ??= seed());

function emit(kind: string, text: string, approval: Approval | null, job: Job | null = null) {
  const s = state();
  s.events.push({
    event_id: s.nextEventId++,
    at: new Date().toISOString(),
    kind,
    text,
    job_id: approval?.job_id ?? job?.job_id ?? null,
    approval_id: approval?.approval_id ?? null,
  });
  if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
}

function update(approval: Approval, patch: Partial<Approval>) {
  const next = { ...approval, ...patch, updated_at: new Date().toISOString() };
  state().approvals.set(next.approval_id, next);
  return next;
}

function setJobStatus(jobId: string, status: Job["status"]) {
  const job = state().jobs.get(jobId);
  if (job) state().jobs.set(jobId, { ...job, status, updated_at: new Date().toISOString() });
}

/** Applies time-based changes (expiry, simulated execution) that are due. */
function tick() {
  const s = state();
  const now = Date.now();

  for (const a of s.approvals.values()) {
    if (a.status === "pending" && Date.parse(a.expires_at) <= now) {
      const next = update(a, { status: "expired" });
      setJobStatus(next.job_id, "succeeded");
      emit("approval.expired", `Approval for ${a.target.issue_id} expired without a decision`, next);
    }
  }

  const due = s.transitions.filter((t) => t.at <= now).sort((x, y) => x.at - y.at);
  s.transitions = s.transitions.filter((t) => t.at > now);
  for (const t of due) {
    const a = s.approvals.get(t.approvalId);
    if (!a) continue;
    if (t.to === "executing" && a.status === "approved") {
      const next = update(a, { status: "executing" });
      emit("approval.executing", `Posting comment to ${a.target.issue_id}`, next);
    } else if (t.to === "succeeded" && a.status === "executing") {
      const receipt = {
        receipt_id: `rcpt_${randomUUID().slice(0, 8)}`,
        action_id: a.action_id,
        comment_url: `${a.target.url}#comment-${randomUUID().slice(0, 6)}`,
        applied_issue_revision: a.target.issue_revision,
        digest: a.digest,
        created_at: new Date().toISOString(),
      };
      const next = update(a, { status: "succeeded", receipt });
      setJobStatus(next.job_id, "succeeded");
      emit("approval.succeeded", `Comment posted to ${a.target.issue_id} (receipt ${receipt.receipt_id})`, next);
    }
  }
}

function getPending(approvalId: string) {
  tick();
  const a = state().approvals.get(approvalId);
  if (!a) throw new MockError(404, `No approval ${approvalId}`);
  return a;
}

export function snapshot(afterEventId: number): Snapshot {
  tick();
  const s = state();
  const latest = s.nextEventId - 1;
  // A client that is ahead of us (e.g. after a mock reset) gets the full tail so it can resync.
  const after = afterEventId > latest ? 0 : afterEventId;
  return {
    jobs: [...s.jobs.values()],
    approvals: [...s.approvals.values()],
    events: s.events.filter((e) => e.event_id > after).slice(-EVENT_TAIL),
    latest_event_id: latest,
  };
}

export function decide(approvalId: string, req: DecisionRequest): Approval {
  const a = getPending(approvalId);
  if (req.decision !== "approve" && req.decision !== "deny") {
    throw new MockError(400, "decision must be 'approve' or 'deny'");
  }
  if (a.status !== "pending") {
    throw new MockError(409, `This approval is already ${a.status.replace("_", " ")}.`, a);
  }
  if (req.revision !== a.revision || req.digest !== a.digest) {
    throw new MockError(409, `The comment changed to revision ${a.revision} before your decision arrived.`, a);
  }

  const decision = {
    decision: req.decision,
    actor: OWNER,
    channel: "web" as const,
    decided_at: new Date().toISOString(),
  };
  if (req.decision === "deny") {
    const next = update(a, { status: "denied", decision });
    setJobStatus(next.job_id, "succeeded");
    emit("approval.denied", `You denied the comment on ${a.target.issue_id}`, next);
    return next;
  }

  const next = update(a, { status: "approved", decision });
  emit("approval.approved", `You approved revision ${a.revision} for ${a.target.issue_id}`, next);
  const now = Date.now();
  state().transitions.push(
    { at: now + EXECUTING_AFTER_MS, approvalId, to: "executing" },
    { at: now + SUCCEEDED_AFTER_MS, approvalId, to: "succeeded" },
  );
  return next;
}

export function revise(approvalId: string, req: RevisionRequest): Approval {
  const a = getPending(approvalId);
  const body = normalizeBody(typeof req.body === "string" ? req.body : "");
  if (!body) throw new MockError(400, "The comment can't be empty.");
  if (body.length > MAX_BODY) throw new MockError(400, `The comment must be at most ${MAX_BODY} characters.`);
  if (a.status !== "pending") {
    throw new MockError(409, `This approval is already ${a.status.replace("_", " ")}.`, a);
  }
  if (req.expected_revision !== a.revision) {
    throw new MockError(409, `Someone else edited this comment (now revision ${a.revision}).`, a);
  }
  if (body === a.body) throw new MockError(400, "The comment is unchanged.");

  const revision = a.revision + 1;
  const action_id = `act_${a.approval_id.replace(/^appr_/, "")}_r${revision}_${randomUUID().slice(0, 4)}`;
  const history = [
    ...a.history,
    { revision: a.revision, body: a.body, action_id: a.action_id, superseded_at: new Date().toISOString() },
  ];
  const draft = { ...a, body, revision, action_id, history };
  const next = update(a, { ...draft, digest: digestOf(draft) });
  emit("approval.revised", `Revision ${revision} of the comment on ${a.target.issue_id}`, next);
  return next;
}

export function reset() {
  g.__irisMock = seed();
}
