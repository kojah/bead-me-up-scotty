import { fail, ok } from "@/lib/api";
import { getConfig, getProject } from "@/lib/config";
import { computeGamification } from "@/lib/gamification";
import { readInteractions } from "@/lib/interactions";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { projectId } = await params;
    const store = await getStore(projectId);
    const cfg = getConfig();
    const beads = await store.list();
    const project = getProject(projectId);
    const repoPath = project && "path" in project ? project.path : null;
    const events = repoPath ? readInteractions(repoPath) : [];

    const data = computeGamification(beads, events, cfg.humanAllowlist, cfg.humanActor, Date.now());
    return ok(data);
  } catch (e) {
    return fail(e);
  }
}
