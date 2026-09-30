"use client";

import { useState } from "react";
import { ConflictError, submitDecision, submitRevision } from "@/lib/iris/client";
import { APPROVAL_STATUS, clockTime, relativeTime, useNow, wordCount } from "@/lib/iris/format";
import type { Approval } from "@/lib/iris/types";
import { StatusBadge, TONE_CLASSES } from "./status-badge";

type ApprovalCardProps = {
  approval: Approval;
  /** Receives the authoritative record after a mutation or conflict. */
  onApplied: (approval: Approval) => void;
};

type Notice = { tone: "danger" | "warning" | "info"; text: string };

export function ApprovalCard({ approval, onApplied }: ApprovalCardProps) {
  const now = useNow();
  const status = APPROVAL_STATUS[approval.status];
  const isPending = approval.status === "pending";

  const [busy, setBusy] = useState<"approve" | "deny" | "revise" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // While editing, remember which revision the draft started from so a concurrent edit is caught.
  const [draft, setDraft] = useState<{ baseRevision: number; body: string } | null>(null);

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<Approval>, success?: string) => {
    setBusy(kind);
    setNotice(null);
    try {
      const updated = await action();
      onApplied(updated);
      if (success) setNotice({ tone: "info", text: success });
      return true;
    } catch (e) {
      if (e instanceof ConflictError) {
        onApplied(e.current);
        setNotice({ tone: "warning", text: `${e.message} Showing the latest version.` });
        setDraft(null);
      } else {
        setNotice({ tone: "danger", text: e instanceof Error ? e.message : String(e) });
      }
      return false;
    } finally {
      setBusy(null);
    }
  };

  const decide = (decision: "approve" | "deny") =>
    run(decision, () =>
      submitDecision(approval.approval_id, { revision: approval.revision, digest: approval.digest, decision }),
    );

  const saveRevision = async () => {
    if (!draft) return;
    const ok = await run(
      "revise",
      () => submitRevision(approval.approval_id, { expected_revision: draft.baseRevision, body: draft.body }),
      "Saved as a new revision. Review it before approving.",
    );
    if (ok) setDraft(null);
  };

  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-border p-5" aria-labelledby={`${approval.approval_id}-title`}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className="font-mono">{approval.target.project}</span>
          <span aria-hidden>/</span>
          <a href={approval.target.url} target="_blank" rel="noreferrer" className="font-mono underline-offset-2 hover:underline">
            {approval.target.issue_id}
          </a>
          <span>· issue revision {approval.target.issue_revision}</span>
        </div>
        <div className="flex items-start justify-between gap-3">
          <h2 id={`${approval.approval_id}-title`} className="text-lg font-semibold leading-snug">
            {approval.target.title}
          </h2>
          <StatusBadge label={status.label} tone={status.tone} />
        </div>
      </header>

      <StatusSummary approval={approval} now={now} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">
            {approval.status === "succeeded" ? "Posted comment" : "Exact comment"}
            <span className="ml-2 font-normal text-muted">revision {approval.revision}</span>
          </h3>
          <span className="text-xs text-muted">{wordCount(approval.body)} words</span>
        </div>

        {draft ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={5}
              aria-label="Edited comment"
              className="w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 leading-relaxed outline-none focus:border-accent"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted">{wordCount(draft.body)} words · saving creates revision {draft.baseRevision + 1}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDraft(null)} disabled={busy !== null} className={SECONDARY_BUTTON}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveRevision}
                  disabled={busy !== null || !draft.body.trim()}
                  className={PRIMARY_BUTTON}
                >
                  {busy === "revise" ? "Saving…" : "Save revision"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          // Rendered as plain text: agent/tool output is never interpreted as HTML.
          <blockquote className="whitespace-pre-wrap rounded-xl bg-surface px-4 py-3 leading-relaxed">{approval.body}</blockquote>
        )}
      </section>

      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${TONE_CLASSES[notice.tone]}`}>
          {notice.text}
        </p>
      )}

      {isPending && !draft && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => decide("approve")} disabled={busy !== null} className={PRIMARY_BUTTON}>
            {busy === "approve" ? "Approving…" : `Approve revision ${approval.revision}`}
          </button>
          <button
            type="button"
            onClick={() => setDraft({ baseRevision: approval.revision, body: approval.body })}
            disabled={busy !== null}
            className={SECONDARY_BUTTON}
          >
            Edit
          </button>
          <button type="button" onClick={() => decide("deny")} disabled={busy !== null} className={DANGER_BUTTON}>
            {busy === "deny" ? "Denying…" : "Deny"}
          </button>
        </div>
      )}

      {approval.uncertainty && (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Uncertainty</h3>
          <p className="text-sm text-muted">{approval.uncertainty}</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">
          Evidence
          <span className="ml-2 font-normal text-muted">
            {approval.snapshot.repository} @ <span className="font-mono">{approval.snapshot.commit}</span>
          </span>
        </h3>
        <ul className="flex flex-col gap-2">
          {approval.evidence.map((ev) => (
            <li key={ev.evidence_id} className="flex flex-col gap-1">
              <a href={ev.url} target="_blank" rel="noreferrer" className="text-sm font-mono text-info underline-offset-2 hover:underline">
                {ev.label}
              </a>
              {ev.excerpt && (
                <pre className="overflow-x-auto rounded-lg bg-surface px-3 py-2 font-mono text-xs leading-relaxed">{ev.excerpt}</pre>
              )}
            </li>
          ))}
        </ul>
      </section>

      {approval.history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            Earlier revisions <span className="font-normal text-muted">({approval.history.length} superseded)</span>
          </summary>
          <ol className="mt-2 flex flex-col gap-2">
            {[...approval.history].reverse().map((h) => (
              <li key={h.revision} className="flex flex-col gap-1 border-l-2 border-border pl-3">
                <span className="text-xs text-muted">
                  Revision {h.revision} · superseded {clockTime(h.superseded_at)} · <span className="font-mono">{h.action_id}</span>
                </span>
                <p className="whitespace-pre-wrap text-muted line-through decoration-muted/50">{h.body}</p>
              </li>
            ))}
          </ol>
        </details>
      )}

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 font-mono text-xs text-muted">
        <span>{approval.approval_id}</span>
        <span>action {approval.action_id}</span>
        <span>{approval.digest}</span>
      </footer>
    </article>
  );
}

function StatusSummary({ approval, now }: { approval: Approval; now: number }) {
  const status = APPROVAL_STATUS[approval.status];
  const { decision, receipt } = approval;

  return (
    <div className={`flex flex-col gap-1 rounded-xl px-4 py-3 text-sm ${TONE_CLASSES[status.tone]}`}>
      <p className="font-medium">
        {status.summary}
        {approval.status === "pending" && now > 0 && ` Expires ${relativeTime(approval.expires_at, now)}.`}
      </p>
      {decision && (
        <p className="text-foreground/80">
          {decision.decision === "approve" ? "Approved" : "Denied"} by {decision.actor} via {decision.channel} at{" "}
          {clockTime(decision.decided_at)}
          {decision.decision === "approve" && ` (revision ${approval.revision})`}.
        </p>
      )}
      {approval.error && <p className="text-foreground/80">{approval.error}</p>}
      {receipt && (
        <p className="text-foreground/80">
          Receipt <span className="font-mono">{receipt.receipt_id}</span> at {clockTime(receipt.created_at)} · applied to issue
          revision {receipt.applied_issue_revision} ·{" "}
          <a href={receipt.comment_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            view comment
          </a>
          {receipt.digest !== approval.digest && (
            <strong className="block text-danger">Receipt digest does not match the approved content.</strong>
          )}
        </p>
      )}
    </div>
  );
}

const BUTTON = "rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-50";
const PRIMARY_BUTTON = `${BUTTON} bg-accent text-accent-fg hover:opacity-90`;
const SECONDARY_BUTTON = `${BUTTON} border border-border bg-surface hover:bg-surface-hover`;
const DANGER_BUTTON = `${BUTTON} bg-danger/10 text-danger hover:bg-danger/20`;
