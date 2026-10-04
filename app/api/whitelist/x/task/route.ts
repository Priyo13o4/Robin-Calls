import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { isXConfigured } from "@/lib/x/config";
import { resolveTargets } from "@/lib/x/targets";
import {
  X_SESSION_COOKIE,
  cookieOptions,
  readSession,
  sealSession,
} from "@/lib/x/session";

/**
 * POST /api/whitelist/x/task   body: { task: "follow" | "like" | "post" }
 *
 * Records that the user completed one onboarding action. The action itself
 * happens in the user's own browser via an x.com/intent/* link (the modal
 * opens it, then calls this) — honor-system by design, ZERO metered X API
 * calls, so the whole flow stays on X's free tier. Identity remains
 * hard-verified: only a session created by the real OAuth callback can reach
 * this, so the attestation is at least bound to a proven X account.
 */
export const dynamic = "force-dynamic";

type Task = "follow" | "like" | "post";

export async function POST(req: NextRequest) {
  if (!flags.whitelist || !isXConfigured()) {
    return NextResponse.json({ error: "X onboarding isn't available." }, { status: 503 });
  }

  const session = readSession(req.cookies.get(X_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: "Connect X first.", reconnect: true },
      { status: 401 }
    );
  }

  let task: Task;
  try {
    task = (await req.json()).task;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!["follow", "like", "post"].includes(task)) {
    return NextResponse.json({ error: "Unknown task" }, { status: 400 });
  }

  // A "like" only exists when a pinned post is configured (the modal hides it
  // otherwise, but don't let a hand-crafted request mark a task that isn't real).
  if (task === "like") {
    const targets = await resolveTargets();
    if (!targets.likeTweetId) {
      return NextResponse.json(
        { error: "No pinned post is configured to like yet." },
        { status: 409 }
      );
    }
  }

  session.tasks[task] = true;

  const res = NextResponse.json({ ok: true, tasks: session.tasks });
  // Re-seal as a session cookie (same lifetime policy as the callback set it).
  res.cookies.set(
    X_SESSION_COOKIE,
    sealSession(session),
    cookieOptions(req.nextUrl.protocol === "https:")
  );
  return res;
}
