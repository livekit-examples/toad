"use client";

import { useSyncExternalStore } from "react";
import type { ApprovalStatus, JobStatus } from "./types";

export type Tone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";

export const APPROVAL_STATUS: Record<ApprovalStatus, { label: string; tone: Tone; summary: string }> = {
  pending: { label: "Needs decision", tone: "accent", summary: "Waiting for your decision." },
  approved: {
    label: "Approved",
    tone: "info",
    summary: "Approved. Waiting for the executor to post it; nothing is posted yet.",
  },
  executing: { label: "Posting", tone: "info", summary: "Posting the comment to the tracker…" },
  succeeded: { label: "Posted", tone: "success", summary: "The comment was posted." },
  failed: { label: "Failed", tone: "danger", summary: "The comment was not posted." },
  denied: { label: "Denied", tone: "neutral", summary: "You denied this comment. Nothing was posted." },
  expired: { label: "Expired", tone: "neutral", summary: "No decision was made in time. Nothing was posted." },
  cancelled: { label: "Cancelled", tone: "neutral", summary: "The job was cancelled. Nothing was posted." },
  outcome_unknown: {
    label: "Outcome unknown",
    tone: "warning",
    summary: "It's not known whether the comment was posted. This needs review.",
  },
};

export const JOB_STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  awaiting_decision: { label: "Needs decision", tone: "accent" },
  succeeded: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

// A shared clock that ticks every 15s, so relative times stay roughly current without per-component timers.
let clockNow = 0;
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!interval) {
    clockNow = Date.now();
    interval = setInterval(() => {
      clockNow = Date.now();
      listeners.forEach((l) => l());
    }, 15_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval) {
      clearInterval(interval);
      interval = null;
    }
  };
}

/** Current time for display, or 0 during server rendering. */
export function useNow() {
  return useSyncExternalStore(subscribe, () => clockNow || (clockNow = Date.now()), () => 0);
}

export function relativeTime(iso: string, now: number) {
  if (!now) return "";
  const diffMin = Math.round((Date.parse(iso) - now) / 60_000);
  const abs = Math.abs(diffMin);
  if (abs < 1) return diffMin >= 0 ? "in under a minute" : "just now";
  const text = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`;
  return diffMin >= 0 ? `in ${text}` : `${text} ago`;
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
