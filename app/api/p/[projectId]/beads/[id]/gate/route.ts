import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string; id: string }> };

/** Create a human approval gate that blocks bead `[id]` (bd gate create --type human). */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { projectId, id } = await params;
    const store = await getStore(projectId);
    const cfg = getConfig();
    const { reason } = z
      .object({ reason: z.string().optional() })
      .parse(await req.json().catch(() => ({})));
    const gate = await store.createGate(id, reason, cfg.humanActor);
    return ok(gate);
  } catch (e) {
    return fail(e);
  }
}
