import { fail, ok } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { addCommentSchema } from "@/lib/schema";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; id: string }> },
) {
  try {
    const { projectId, id } = await params;
    const store = await getStore(projectId);
    const cfg = getConfig();
    const { text } = addCommentSchema.parse(await req.json());
    const bead = await store.addComment(id, text, cfg.humanActor);
    return ok(bead);
  } catch (e) {
    return fail(e);
  }
}
