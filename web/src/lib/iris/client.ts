import type {
  Approval,
  ConflictResponse,
  DecisionRequest,
  RevisionRequest,
  Snapshot,
} from "./types";

/**
 * Base URL of the Iris backend. Defaults to the in-app fixture backend under /api/mock, which
 * mirrors the planned routes. Point this at B's backend once it's live.
 */
export const IRIS_API_URL = process.env.NEXT_PUBLIC_IRIS_API_URL || "/api/mock";
export const USING_FIXTURES = IRIS_API_URL === "/api/mock";

export class ConflictError extends Error {
  constructor(public readonly current: Approval, message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${IRIS_API_URL}${path}`, {
    ...init,
    // B's owner session is cookie-based.
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (res.status === 409) {
    const body = (await res.json()) as ConflictResponse;
    throw new ConflictError(body.current, body.message);
  }
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function getSnapshot(afterEventId: number, signal?: AbortSignal) {
  return request<Snapshot>(`/snapshot?after_event_id=${afterEventId}`, { signal });
}

export function submitDecision(approvalId: string, body: DecisionRequest) {
  return request<Approval>(`/approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function submitRevision(approvalId: string, body: RevisionRequest) {
  return request<Approval>(`/approvals/${encodeURIComponent(approvalId)}/revisions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
