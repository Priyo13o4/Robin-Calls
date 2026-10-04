import { NextResponse } from "next/server";
import { queryPublishedPlatforms } from "@/lib/data/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const platforms = await queryPublishedPlatforms();
    return NextResponse.json(
      { ok: true, platforms },
      {
        headers: {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error("[api/ecosystem/platforms] error:", error);
    return NextResponse.json({ ok: false, platforms: [] }, { status: 500 });
  }
}
