import { assistBead } from "@/lib/ai";
import { fail, ok } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string; id: string }> };

/** Refine/triage a bead with the local Claude CLI. Read-only — returns
 *  suggestions; the client applies them only on explicit confirmation. */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { projectId, id } = await params;
    const store = await getStore(projectId);
    const beads = await store.list();
    const bead = beads.find((b) => b.id === id);
    if (!bead) return fail(new Error(`Unknown bead: ${id}`));

    const result = await assistBead({
      id: bead.id,
      title: bead.title,
      description: bead.description ?? "",
      type: bead.issue_type,
      labels: bead.labels ?? [],
      others: beads.filter((b) => b.id !== id).map((b) => ({ id: b.id, title: b.title })),
    });
    return ok(result);
  } catch (e) {
    return fail(e);
  }
}
