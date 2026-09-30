// Disclosed fixture data for the inbox. The pending approval is the plan's seeded story: the agent
// drafts a short comment on a reconnect bug, and the demo edit adds "it reproduces after reconnecting".
// The other approvals cover every state the UI must render.
import type { Approval, Evidence, IrisEvent, Job } from "./types";

const PROJECT = "toad-demo";
const REPO = "toad-demo/room-sdk";
const COMMIT = "4f2c9e1";
const OWNER = "owner@toad.test";

const gateway = (path: string) => `/gateway/${path}`;

function iso(now: number, offsetMinutes: number) {
  return new Date(now + offsetMinutes * 60_000).toISOString();
}

function evidence(issue: string, items: Array<[label: string, path: string, excerpt: string | null]>): Evidence[] {
  return items.map(([label, path, excerpt], i) => ({
    evidence_id: `ev_${issue}_${i + 1}`,
    label,
    url: gateway(`evidence/${issue}/${path}`),
    excerpt,
  }));
}

type ApprovalSeed = Omit<Approval, "digest" | "snapshot" | "created_at" | "updated_at"> & {
  created: number;
  updated: number;
};

export type FixtureState = {
  jobs: Job[];
  approvals: Array<Omit<Approval, "digest">>;
  events: Array<Omit<IrisEvent, "event_id">>;
};

/** Builds the fixture world with timestamps relative to `now`. Digests are filled in by the store. */
export function buildFixtures(now: number): FixtureState {
  const approval = ({ created, updated, ...a }: ApprovalSeed): Omit<Approval, "digest"> => ({
    ...a,
    snapshot: { repository: REPO, commit: COMMIT },
    created_at: iso(now, created),
    updated_at: iso(now, updated),
  });

  const approvals: Array<Omit<Approval, "digest">> = [
    approval({
      approval_id: "appr_142",
      job_id: "job_142",
      status: "pending",
      revision: 1,
      action_id: "act_142_r1",
      target: {
        project: PROJECT,
        issue_id: "TOAD-142",
        title: "Remote audio stays silent after network change",
        url: gateway("issues/TOAD-142"),
        issue_revision: 3,
      },
      body:
        "Root cause: reconnect() re-creates the subscriber transport but never re-enables remote audio tracks, so they stay muted. Fix: call setEnabled(true) on each track after resubscribing.",
      evidence: evidence("TOAD-142", [
        [
          "src/room/reconnect.ts:88-104",
          "reconnect.ts",
          "await this.subscriber.recreate();\n// TODO: restore track enabled state\nthis.emit('reconnected');",
        ],
        ["Issue report: steps to reproduce", "report", "Switch from Wi-Fi to cellular mid-call; remote audio goes silent."],
        ["src/room/track.ts:41 setEnabled()", "track.ts", null],
      ]),
      uncertainty: "Only the Wi-Fi to cellular path was traced. A full ICE restart may take a different code path.",
      expires_at: iso(now, 30),
      history: [],
      decision: null,
      receipt: null,
      error: null,
      created: -4,
      updated: -4,
    }),
    approval({
      approval_id: "appr_137",
      job_id: "job_137",
      status: "succeeded",
      revision: 2,
      action_id: "act_137_r2",
      target: {
        project: PROJECT,
        issue_id: "TOAD-137",
        title: "Data channel messages arrive out of order",
        url: gateway("issues/TOAD-137"),
        issue_revision: 7,
      },
      body:
        "Messages are sent on the lossy channel, which does not guarantee order. Switching to the reliable channel fixes it and adds about 20ms of latency in local tests.",
      evidence: evidence("TOAD-137", [
        ["src/data/publish.ts:22", "publish.ts", "const kind = opts.reliable ? Reliable : Lossy; // defaults to Lossy"],
      ]),
      uncertainty: null,
      expires_at: iso(now, -60),
      history: [
        {
          revision: 1,
          body: "Messages are sent on the lossy channel, which does not guarantee order. Switching to the reliable channel fixes it.",
          action_id: "act_137_r1",
          superseded_at: iso(now, -95),
        },
      ],
      decision: { decision: "approve", actor: OWNER, channel: "phone", decided_at: iso(now, -94) },
      receipt: {
        receipt_id: "rcpt_137",
        action_id: "act_137_r2",
        comment_url: gateway("issues/TOAD-137#comment-1"),
        applied_issue_revision: 7,
        digest: "",
        created_at: iso(now, -93),
      },
      error: null,
      created: -110,
      updated: -93,
    }),
    approval({
      approval_id: "appr_131",
      job_id: "job_131",
      status: "denied",
      revision: 1,
      action_id: "act_131_r1",
      target: {
        project: PROJECT,
        issue_id: "TOAD-131",
        title: "Screen share frame rate drops on Safari",
        url: gateway("issues/TOAD-131"),
        issue_revision: 2,
      },
      body: "This looks like Safari's encoder limit. Suggest closing as won't fix.",
      evidence: evidence("TOAD-131", [["Issue report", "report", null]]),
      uncertainty: "No Safari build was available to confirm the encoder limit.",
      expires_at: iso(now, -120),
      history: [],
      decision: { decision: "deny", actor: OWNER, channel: "web", decided_at: iso(now, -150) },
      receipt: null,
      error: null,
      created: -170,
      updated: -150,
    }),
    approval({
      approval_id: "appr_128",
      job_id: "job_128",
      status: "expired",
      revision: 1,
      action_id: "act_128_r1",
      target: {
        project: PROJECT,
        issue_id: "TOAD-128",
        title: "Typo in connection error message",
        url: gateway("issues/TOAD-128"),
        issue_revision: 1,
      },
      body: "Confirmed: 'recieved' should be 'received' in src/errors.ts line 12.",
      evidence: evidence("TOAD-128", [["src/errors.ts:12", "errors.ts", "throw new Error('No response recieved');"]]),
      uncertainty: null,
      expires_at: iso(now, -200),
      history: [],
      decision: null,
      receipt: null,
      error: null,
      created: -260,
      updated: -200,
    }),
    approval({
      approval_id: "appr_125",
      job_id: "job_125",
      status: "outcome_unknown",
      revision: 1,
      action_id: "act_125_r1",
      target: {
        project: PROJECT,
        issue_id: "TOAD-125",
        title: "Token refresh races with reconnect",
        url: gateway("issues/TOAD-125"),
        issue_revision: 4,
      },
      body: "The refresh timer is not cleared on disconnect. A late refresh can overwrite the new session's token.",
      evidence: evidence("TOAD-125", [["src/auth/refresh.ts:57", "refresh.ts", null]]),
      uncertainty: null,
      expires_at: iso(now, -240),
      history: [],
      decision: { decision: "approve", actor: OWNER, channel: "web", decided_at: iso(now, -300) },
      receipt: null,
      error: "The tracker did not respond after the write was sent. Reconciling by receipt lookup; the comment may or may not exist.",
      created: -320,
      updated: -299,
    }),
    approval({
      approval_id: "appr_120",
      job_id: "job_120",
      status: "failed",
      revision: 1,
      action_id: "act_120_r1",
      target: {
        project: PROJECT,
        issue_id: "TOAD-120",
        title: "Echo cancellation disabled on Firefox",
        url: gateway("issues/TOAD-120"),
        issue_revision: 5,
      },
      body: "echoCancellation is only set in the Chrome constraints branch. Firefox falls through with defaults.",
      evidence: evidence("TOAD-120", [["src/media/constraints.ts:30", "constraints.ts", null]]),
      uncertainty: null,
      expires_at: iso(now, -400),
      history: [],
      decision: { decision: "approve", actor: OWNER, channel: "web", decided_at: iso(now, -420) },
      receipt: null,
      error: "The issue moved from revision 5 to 6 before the write, so the comment was not posted.",
      created: -440,
      updated: -419,
    }),
    approval({
      approval_id: "appr_118",
      job_id: "job_118",
      status: "cancelled",
      revision: 1,
      action_id: "act_118_r1",
      target: {
        project: PROJECT,
        issue_id: "TOAD-118",
        title: "Participant list flickers on join",
        url: gateway("issues/TOAD-118"),
        issue_revision: 2,
      },
      body: "Each join event triggers a full re-sort. Debouncing the sort would stop the flicker.",
      evidence: evidence("TOAD-118", [["src/ui/participants.tsx:14", "participants.tsx", null]]),
      uncertainty: null,
      expires_at: iso(now, -500),
      history: [],
      decision: null,
      receipt: null,
      error: null,
      created: -520,
      updated: -510,
    }),
  ];

  const job = (
    job_id: string,
    title: string,
    status: Job["status"],
    issue_id: string | null,
    approval_id: string | null,
    created: number,
    updated: number,
    milestone: string | null = null,
  ): Job => ({
    job_id,
    title,
    status,
    milestone,
    issue_id,
    approval_id,
    created_at: iso(now, created),
    updated_at: iso(now, updated),
  });

  const jobs: Job[] = [
    job("job_151", "Investigate TOAD-151: Camera permission prompt repeats", "queued", "TOAD-151", null, -0.5, -0.5),
    job(
      "job_150",
      "Investigate TOAD-150: Captions lag behind speech",
      "running",
      "TOAD-150",
      null,
      -2,
      -0.2,
      "Reading src/captions/buffer.ts (3 of 5 files)",
    ),
    job("job_142", "Investigate TOAD-142: Remote audio stays silent after network change", "awaiting_decision", "TOAD-142", "appr_142", -9, -4),
    job("job_137", "Investigate TOAD-137: Data channel messages arrive out of order", "succeeded", "TOAD-137", "appr_137", -120, -93),
    job("job_131", "Investigate TOAD-131: Screen share frame rate drops on Safari", "succeeded", "TOAD-131", "appr_131", -180, -150),
    job("job_128", "Investigate TOAD-128: Typo in connection error message", "succeeded", "TOAD-128", "appr_128", -270, -200),
    job("job_125", "Investigate TOAD-125: Token refresh races with reconnect", "succeeded", "TOAD-125", "appr_125", -330, -299),
    job("job_120", "Investigate TOAD-120: Echo cancellation disabled on Firefox", "succeeded", "TOAD-120", "appr_120", -450, -419),
    job("job_118", "Investigate TOAD-118: Participant list flickers on join", "cancelled", "TOAD-118", "appr_118", -530, -510),
    job("job_112", "Investigate TOAD-112: Crash when leaving during reconnect", "failed", "TOAD-112", null, -600, -590),
  ];

  const event = (at: number, kind: string, text: string, job_id: string | null, approval_id: string | null = null) => ({
    at: iso(now, at),
    kind,
    text,
    job_id,
    approval_id,
  });

  const events = [
    event(-9, "job.running", "Started investigating TOAD-142", "job_142"),
    event(-6, "job.milestone", "Traced reconnect() in src/room/reconnect.ts", "job_142"),
    event(-4, "approval.created", "Drafted a comment on TOAD-142 for your approval", "job_142", "appr_142"),
    event(-2, "job.running", "Started investigating TOAD-150", "job_150"),
    event(-0.5, "job.queued", "Queued TOAD-151", "job_151"),
    event(-0.2, "job.milestone", "Reading src/captions/buffer.ts (3 of 5 files)", "job_150"),
  ];

  return { jobs, approvals, events };
}
