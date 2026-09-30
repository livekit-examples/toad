import { snapshot } from "@/lib/iris/mock-store";
import { respond } from "../respond";

export async function GET(request: Request) {
  const after = Number(new URL(request.url).searchParams.get("after_event_id") ?? 0);
  return respond(() => snapshot(Number.isFinite(after) && after > 0 ? after : 0));
}
