import { reset } from "@/lib/iris/mock-store";
import { respond } from "../respond";

// Fixture-only: restores the seeded demo data.
export async function POST() {
  return respond(() => {
    reset();
    return { ok: true };
  });
}
