import { NextRequest, NextResponse } from "next/server";
import { DIRECTORY_CATEGORY_VALUES, sanitizeDetails } from "@/lib/config/ecosystem";
import { insertDirectorySubmission } from "@/lib/data/registry";

/**
 * Public "LIST YOUR PLATFORM" submission (§Prompt 7). Lands as a `pending`
 * row — never shown until manually reviewed.
 *
 * `details` is the per-category optional block (launch model, custody model,
 * MCP endpoint, …). It is validated against lib/config/ecosystem.ts — unknown
 * keys are dropped, selects must match an option — so the jsonb column only
 * ever holds shapes the config declares.
 */

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot: a hidden "website" field no human sees. If it's filled, a bot
  // did it — accept quietly (200) so the bot moves on, but write nothing.
  if (String(body.website ?? "").trim()) {
    return NextResponse.json({ ok: true });
  }

  const name = String(body.name ?? "").trim();
  const url = String(body.url ?? "").trim();
  const description = String(body.description ?? "").trim();
  const contact = String(body.contact ?? "").trim();
  const category = String(body.category ?? "").trim().toUpperCase();
  const bannerUrl = String(body.banner_url ?? "").trim();

  if (!name || name.length > 120) {
    return NextResponse.json({ error: "A platform name is required." }, { status: 400 });
  }
  if (!/^https?:\/\/.{3,}/.test(url)) {
    return NextResponse.json({ error: "A valid URL is required." }, { status: 400 });
  }
  if (!DIRECTORY_CATEGORY_VALUES.includes(category)) {
    return NextResponse.json({ error: "Pick a valid category." }, { status: 400 });
  }
  // Optional — but if given, must at least look like a URL. The real check
  // (does it actually serve an image?) happens live, per request, in
  // app/api/og-proxy — this is just enough to reject garbage at submission.
  if (bannerUrl && !/^https?:\/\/.{3,}/.test(bannerUrl)) {
    return NextResponse.json({ error: "Banner URL doesn't look like a URL." }, { status: 400 });
  }

  const { details, hasMcp, hasAgent } = sanitizeDetails(category, body.details);

  const { id } = await insertDirectorySubmission({
    name,
    url,
    description: description || "",
    contact: contact || undefined,
    category,
    category_details: details as Record<string, unknown>,
    has_mcp: hasMcp,
    has_agent: hasAgent,
    banner_url: bannerUrl || undefined,
  });

  if (!id) {
    return NextResponse.json({ error: "Could not save the submission." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id });

}
