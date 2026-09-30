"use client";

import { useRef, useState } from "react";
import { USING_FIXTURES } from "@/lib/iris/client";
import { APPROVAL_STATUS, JOB_STATUS, clockTime } from "@/lib/iris/format";
import type { Approval, Job } from "@/lib/iris/types";
import type { IrisSnapshot } from "@/lib/iris/use-snapshot";
import { ApprovalCard } from "./approval-card";
import { StatusBadge } from "./status-badge";

const ACTIVE_JOB: ReadonlySet<Job["status"]> = new Set(["queued", "running", "awaiting_decision"]);

export function InboxView({ iris }: { iris: IrisSnapshot }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // On narrow screens the card sits above the lists, so bring it into view after picking one.
  const select = (id: string) => {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Pending first, then most recently updated.
  const approvals = [...iris.approvals].sort(
    (a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") || b.updated_at.localeCompare(a.updated_at),
  );
  const jobs = [...iris.jobs].sort(
    (a, b) => Number(ACTIVE_JOB.has(b.status)) - Number(ACTIVE_JOB.has(a.status)) || b.updated_at.localeCompare(a.updated_at),
  );
  const selected =
    approvals.find((a) => a.approval_id === selectedId) ?? approvals.find((a) => a.status === "pending") ?? approvals[0];
  const loading = iris.lastSyncedAt === null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <ConnectionBar iris={iris} />

      {loading ? (
        <p className="py-16 text-center text-muted">{iris.lastError ? "Can't reach the backend yet." : "Loading…"}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <DecisionList approvals={approvals} selectedId={selected?.approval_id} onSelect={select} />
            <WorkList jobs={jobs} onSelectApproval={select} />
          </div>
          {/* The selected decision comes first on narrow screens so a pending one isn't buried. */}
          <div ref={detailRef} className="order-first flex scroll-mt-4 flex-col gap-6 lg:order-none">
            {selected ? (
              <ApprovalCard key={selected.approval_id} approval={selected} onApplied={iris.applyApproval} />
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted">No decisions yet.</p>
            )}
            <ActivityFeed iris={iris} />
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionBar({ iris }: { iris: IrisSnapshot }) {
  const [resetting, setResetting] = useState(false);

  const resetFixtures = async () => {
    setResetting(true);
    try {
      await fetch("/api/mock/reset", { method: "POST" });
      iris.refresh();
    } finally {
      setResetting(false);
    }
  };

  const dot =
    iris.connection === "live" ? "bg-success" : iris.connection === "retrying" ? "bg-warning animate-pulse" : "bg-muted";
  const text =
    iris.connection === "live"
      ? "Live"
      : iris.connection === "retrying"
        ? `Reconnecting… ${iris.lastSyncedAt ? `showing the last update from ${clockTime(new Date(iris.lastSyncedAt).toISOString())}` : ""}`
        : "Connecting…";

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="flex items-center gap-2" role="status" title={iris.lastError ?? undefined}>
        <span className={`size-2 rounded-full ${dot}`} aria-hidden />
        {text}
      </span>
      {USING_FIXTURES && (
        <>
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">Fixture data</span>
          <button
            type="button"
            onClick={resetFixtures}
            disabled={resetting}
            className="ml-auto text-xs text-muted underline-offset-2 hover:underline disabled:opacity-50"
          >
            Reset fixtures
          </button>
        </>
      )}
    </div>
  );
}

function DecisionList({
  approvals,
  selectedId,
  onSelect,
}: {
  approvals: Approval[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const pending = approvals.filter((a) => a.status === "pending").length;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        Decisions <span className="font-normal text-muted">{pending ? `${pending} waiting` : "none waiting"}</span>
      </h2>
      <ul className="flex flex-col gap-1">
        {approvals.map((a) => {
          const status = APPROVAL_STATUS[a.status];
          const active = a.approval_id === selectedId;
          return (
            <li key={a.approval_id}>
              <button
                type="button"
                onClick={() => onSelect(a.approval_id)}
                aria-current={active}
                className={`flex w-full flex-col gap-1 rounded-xl px-3 py-2 text-left transition ${
                  active ? "bg-surface-hover" : "hover:bg-surface"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted">{a.target.issue_id}</span>
                  <StatusBadge label={status.label} tone={status.tone} />
                </span>
                <span className="line-clamp-2 min-w-0 text-sm">{a.target.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WorkList({ jobs, onSelectApproval }: { jobs: Job[]; onSelectApproval: (id: string) => void }) {
  const active = jobs.filter((j) => ACTIVE_JOB.has(j.status)).length;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">
        Work <span className="font-normal text-muted">{active} active</span>
      </h2>
      <ul className="flex flex-col gap-1">
        {jobs.map((j) => {
          const status = JOB_STATUS[j.status];
          const body = (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm">{j.title}</span>
                <StatusBadge label={status.label} tone={status.tone} />
              </span>
              {j.milestone && j.status === "running" && <span className="text-xs text-muted">{j.milestone}</span>}
            </>
          );
          return (
            <li key={j.job_id}>
              {j.approval_id ? (
                <button
                  type="button"
                  onClick={() => onSelectApproval(j.approval_id!)}
                  className="flex w-full flex-col gap-1 rounded-xl px-3 py-2 text-left transition hover:bg-surface"
                >
                  {body}
                </button>
              ) : (
                <div className="flex flex-col gap-1 px-3 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ActivityFeed({ iris }: { iris: IrisSnapshot }) {
  const events = [...iris.events].reverse().slice(0, 12);
  if (events.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Activity</h2>
      <ol className="flex flex-col gap-1.5 text-sm">
        {events.map((e) => (
          <li key={e.event_id} className="flex gap-3">
            <time dateTime={e.at} className="w-16 shrink-0 text-muted">
              {clockTime(e.at)}
            </time>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
