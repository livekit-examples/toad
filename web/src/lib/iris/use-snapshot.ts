"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSnapshot } from "./client";
import type { Approval, IrisEvent, Job } from "./types";

const ACTIVE_INTERVAL_MS = 1000;
const HIDDEN_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 15_000;
const FEED_LIMIT = 100;

export type ConnectionState = "connecting" | "live" | "retrying";

export type IrisState = {
  jobs: Job[];
  approvals: Approval[];
  /** Deduplicated activity feed, oldest first. */
  events: IrisEvent[];
  latestEventId: number;
  connection: ConnectionState;
  /** When the last snapshot was applied; kept across failures so the UI can say how stale it is. */
  lastSyncedAt: number | null;
  lastError: string | null;
};

const INITIAL: IrisState = {
  jobs: [],
  approvals: [],
  events: [],
  latestEventId: 0,
  connection: "connecting",
  lastSyncedAt: null,
  lastError: null,
};

/**
 * Polls `GET /snapshot?after_event_id=N` once per second while the page is visible, backing off when
 * hidden or failing. Only one request is in flight at a time. Each response replaces the current
 * records; events are appended and deduplicated by `event_id`.
 */
export function useIrisSnapshot() {
  const [state, setState] = useState<IrisState>(INITIAL);
  const latestEventId = useRef(0);
  const failures = useRef(0);
  // Responses to requests started before `minAcceptedRequest` are stale (a newer record was applied).
  const requestSeq = useRef(0);
  const minAcceptedRequest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const poll = useRef<() => void>(() => {});

  const schedule = useCallback((delay: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => poll.current(), delay);
  }, []);

  useEffect(() => {
    let disposed = false;

    poll.current = async () => {
      if (disposed || inFlight.current) return;
      const seq = ++requestSeq.current;
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const snap = await getSnapshot(latestEventId.current, controller.signal);
        if (disposed || seq < minAcceptedRequest.current) return;
        // A lower latest_event_id means the backend was reset; start the feed over.
        const restarted = snap.latest_event_id < latestEventId.current;
        latestEventId.current = snap.latest_event_id;
        failures.current = 0;
        setState((prev) => {
          const known = restarted ? [] : prev.events;
          const seen = new Set(known.map((e) => e.event_id));
          const events = [...known, ...snap.events.filter((e) => !seen.has(e.event_id))]
            .sort((a, b) => a.event_id - b.event_id)
            .slice(-FEED_LIMIT);
          return {
            jobs: snap.jobs,
            approvals: snap.approvals,
            events,
            latestEventId: snap.latest_event_id,
            connection: "live",
            lastSyncedAt: Date.now(),
            lastError: null,
          };
        });
      } catch (e) {
        if (disposed || controller.signal.aborted) return;
        failures.current += 1;
        setState((prev) => ({
          ...prev,
          connection: "retrying",
          lastError: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        if (inFlight.current === controller) inFlight.current = null;
      }
      if (disposed) return;
      const backoff = failures.current
        ? Math.min(MAX_BACKOFF_MS, ACTIVE_INTERVAL_MS * 2 ** failures.current)
        : ACTIVE_INTERVAL_MS;
      schedule(document.hidden ? Math.max(backoff, HIDDEN_INTERVAL_MS) : backoff);
    };

    const onVisibility = () => {
      if (!document.hidden) schedule(0);
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule(0);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearTimeout(timer.current);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [schedule]);

  /**
   * Applies an authoritative approval returned by a mutation (or a 409), discards any snapshot
   * already in flight so it can't overwrite it with older data, and polls again right away.
   */
  const applyApproval = useCallback(
    (approval: Approval) => {
      minAcceptedRequest.current = requestSeq.current + 1;
      setState((prev) => ({
        ...prev,
        approvals: prev.approvals.map((a) => (a.approval_id === approval.approval_id ? approval : a)),
      }));
      inFlight.current?.abort();
      inFlight.current = null;
      schedule(0);
    },
    [schedule],
  );

  const refresh = useCallback(() => schedule(0), [schedule]);

  return { ...state, applyApproval, refresh };
}

export type IrisSnapshot = ReturnType<typeof useIrisSnapshot>;
