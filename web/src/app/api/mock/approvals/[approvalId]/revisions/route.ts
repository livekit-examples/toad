import { revise } from "@/lib/iris/mock-store";
import type { RevisionRequest } from "@/lib/iris/types";
import { readJson, respond } from "../../../respond";

export async function POST(request: Request, ctx: RouteContext<"/api/mock/approvals/[approvalId]/revisions">) {
  const { approvalId } = await ctx.params;
  return respond(async () => revise(approvalId, (await readJson(request)) as RevisionRequest));
}
