import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { archiveIfDone } from "@/generation/archive";
import { PLATFORM_KEY_COOKIE, resolveCredentials } from "@/generation/credentials";
import { createPlatformClient } from "@/generation/platform";
import { logIfFinal } from "@/generation/usage-log";

/** Fetches a run the studio stopped watching (it timed out, or the tab was
    closed) and archives it if it has finished: /api/recover?id=<request id>.
    Uses the key stored in this browser, or HF_API_KEY. */
export async function GET(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Missing ?id=<request id>" }, { status: 400 });

  const jar = await cookies();
  const stored = resolveCredentials(jar.get(PLATFORM_KEY_COOKIE)?.value);
  const baseUrl = process.env.HF_API_BASE_URL;
  if (!stored) return NextResponse.json({ error: "No platform key in this browser or HF_API_KEY" }, { status: 401 });
  if (!baseUrl) return NextResponse.json({ error: "Missing HF_API_BASE_URL" }, { status: 500 });

  try {
    const status = await createPlatformClient({ ...stored, baseUrl }).status(id);
    archiveIfDone(id, status);
    logIfFinal(id, stored.apiKey, status);
    return NextResponse.json({
      status: status.status,
      video: status.video?.url ?? null,
      images: status.images?.map((image) => image.url) ?? [],
      archived: status.status === "completed",
    });
  } catch (caught) {
    return NextResponse.json(
      { error: caught instanceof Error ? caught.message : String(caught) },
      { status: 502 },
    );
  }
}
