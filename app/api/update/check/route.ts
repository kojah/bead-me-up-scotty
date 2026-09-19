import { z } from "zod";
import { fail, ok } from "@/lib/api";
import { checkForUpdate } from "@/lib/self-update";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const channel = z
      .enum(["stable", "development"])
      .parse(new URL(request.url).searchParams.get("channel") || "stable");
    return ok(await checkForUpdate(channel));
  } catch (e) {
    return fail(e);
  }
}
