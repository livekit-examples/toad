// Provisional wire types for the Iris backend (Dev B).
//
// These are a best guess at the master-plan contract and exist so the inbox can be built against
// fixtures. Replace this file with B's generated types once the canonical schema is agreed; nothing
// else in the UI should define its own copies of these shapes.

export type JobStatus = "queued" | "running" | "awaiting_decision" | "succeeded" | "failed" | "cancelled";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "denied"
  | "expired"
  | "cancelled"
  | "outcome_unknown";

export type DecisionChannel = "web" | "phone";

export type Job = {
  job_id: string;
  title: string;
  status: JobStatus;
  /** Latest bounded progress text from the investigation, if any. */
  milestone: string | null;
  issue_id: string | null;
  approval_id: string | null;
  created_at: string;
  updated_at: string;
};

export type IssueTarget = {
  project: string;
  issue_id: string;
  title: string;
  /** Owner-gateway URL for the issue. */
  url: string;
  /** Issue revision the comment was drafted against; the tracker rejects writes if it has moved. */
  issue_revision: number;
};

export type Evidence = {
  evidence_id: string;
  label: string;
  /** Owner-gateway URL; never a public fixture URL. */
  url: string;
  excerpt: string | null;
};

export type CodeSnapshot = {
  repository: string;
  commit: string;
};

export type SupersededRevision = {
  revision: number;
  body: string;
  action_id: string;
  superseded_at: string;
};

export type Decision = {
  decision: "approve" | "deny";
  actor: string;
  channel: DecisionChannel;
  decided_at: string;
};

export type Receipt = {
  receipt_id: string;
  action_id: string;
  /** Owner-gateway URL for the posted comment. */
  comment_url: string;
  applied_issue_revision: number;
  /** Digest of the approved content, which must match the approval's digest. */
  digest: string;
  created_at: string;
};

export type Approval = {
  approval_id: string;
  job_id: string;
  status: ApprovalStatus;
  /** Monotonic approval revision; bumps on every edit. */
  revision: number;
  /** Digest of the exact normalized action for this revision. */
  digest: string;
  /** Executor-reserved idempotency key for this revision's write. */
  action_id: string;
  target: IssueTarget;
  /** The exact comment body that will be posted. */
  body: string;
  evidence: Evidence[];
  snapshot: CodeSnapshot;
  uncertainty: string | null;
  expires_at: string;
  history: SupersededRevision[];
  decision: Decision | null;
  receipt: Receipt | null;
  /** Human-readable failure or unknown-outcome detail. */
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type IrisEvent = {
  event_id: number;
  at: string;
  kind: string;
  text: string;
  job_id: string | null;
  approval_id: string | null;
};

export type Snapshot = {
  jobs: Job[];
  approvals: Approval[];
  /** Bounded tail of events with `event_id > after_event_id`. */
  events: IrisEvent[];
  latest_event_id: number;
};

export type DecisionRequest = {
  revision: number;
  digest: string;
  decision: "approve" | "deny";
};

export type RevisionRequest = {
  expected_revision: number;
  body: string;
};

/** Body of a 409 response: the request was stale, and this is the authoritative current record. */
export type ConflictResponse = {
  error: "conflict";
  message: string;
  current: Approval;
};
