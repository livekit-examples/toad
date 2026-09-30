import { MockError } from "@/lib/iris/mock-store";
import type { ConflictResponse } from "@/lib/iris/types";

const NO_STORE = { "Cache-Control": "no-store" };

// The fixture backend only exists while the UI is pointed at it; with a real backend configured
// these routes 404 so fixtures can't leak into a deployment.
const MOCK_ENABLED = (process.env.NEXT_PUBLIC_IRIS_API_URL || "/api/mock") === "/api/mock";

/** Runs a mock-store operation and maps its errors onto the planned HTTP responses. */
export async function respond(fn: () => unknown) {
  if (!MOCK_ENABLED) return new Response(null, { status: 404 });
  try {
    return Response.json(await fn(), { headers: NO_STORE });
  } catch (e) {
    if (e instanceof MockError) {
      if (e.status === 409 && e.current) {
        const body: ConflictResponse = { error: "conflict", message: e.message, current: e.current };
        return Response.json(body, { status: 409, headers: NO_STORE });
      }
      return Response.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    }
    throw e;
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object") return body;
  } catch {}
  throw new MockError(400, "Expected a JSON object body.");
}
