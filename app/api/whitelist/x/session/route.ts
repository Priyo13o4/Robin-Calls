import { NextRequest, NextResponse } from "next/server";
import { isXConfigured, xIntents } from "@/lib/x/config";
import { resolveTargets } from "@/lib/x/targets";
import { X_SESSION_COOKIE, readSession } from "@/lib/x/session";

/**
 * GET /api/whitelist/x/session
 * The modal polls this to render the connected identity + task checklist,
 * plus the x.com/intent/* URLs for the free (no-API) engagement steps.
 * Never exposes tokens — only the username, name, and which tasks are done.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isXConfigured()) {
    return NextResponse.json({ configured: false, connected: false });
  }
  const session = readSession(req.cookies.get(X_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ configured: true, connected: false });
  }
  const targets = await resolveTargets();
  return NextResponse.json({
    configured: true,
    connected: true,
    username: session.username,
    name: session.name,
    tasks: session.tasks,
    // A "like" needs a real pinned-post URL in site config; when absent the
    // modal hides that task instead of offering a dead intent link.
    likeAvailable: Boolean(targets.likeTweetId),
    // Ready-made intent URLs — the engagement steps open these in the user's
    // own browser (zero X API cost); the modal never builds them itself.
    intents: {
      follow: targets.targetUsername ? xIntents.follow(targets.targetUsername) : null,
      like: targets.likeTweetId ? xIntents.like(targets.likeTweetId) : null,
      post: xIntents.post(targets.postText),
    },
  });
}
