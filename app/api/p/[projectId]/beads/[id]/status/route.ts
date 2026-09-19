import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { BEAD_STATUSES } from "@/lib/schema";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  status: z.enum(BEAD_STATUSES),
  /** Optional close reason; ignored for every status other than `closed`. */
  reason: z.string().max(10_000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; id: string }> },
) {
  try {
    const { projectId, id } = await params;
    const store = await getStore(projectId);
    const cfg = getConfig();
    const { status, reason } = bodySchema.parse(await req.json());
    const bead = await store.setStatus(id, status, cfg.humanActor, reason);
    return ok(bead);
  } catch (e) {
    return fail(e);
  }
}
