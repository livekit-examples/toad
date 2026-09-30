import { decide } from "@/lib/iris/mock-store";
import type { DecisionRequest } from "@/lib/iris/types";
import { readJson, respond } from "../../../respond";

export async function POST(request: Request, ctx: RouteContext<"/api/mock/approvals/[approvalId]/decision">) {
  const { approvalId } = await ctx.params;
  return respond(async () => decide(approvalId, (await readJson(request)) as DecisionRequest));
}
