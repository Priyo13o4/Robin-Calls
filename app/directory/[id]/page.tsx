import { permanentRedirect, notFound } from "next/navigation";
import { getPublishedPlatformById } from "@/lib/data/registry";

/**
 * Legacy `/directory/<id>` → `/ecosystem/<slug>`, permanent (Next emits 308,
 * which Google consolidates exactly as a 301).
 *
 * A route file rather than a `next.config` rewrite because the hop needs a
 * database read: only the row knows its slug, and the old URLs are numeric.
 *
 * This exists so the rename costs nothing that was already earned. Every
 * inbound link, bookmark and crawl record pointing at a numeric id keeps
 * resolving, and `permanentRedirect` is what tells Google to move the ranking
 * signal across rather than treat /ecosystem/<slug> as a brand-new page.
 *
 * Delete only when the logs show no traffic here — not on a schedule.
 */
export const revalidate = 300;

export default async function LegacyDirectoryRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const p = await getPublishedPlatformById(n);
  // A 404 here is correct: the row is gone or was never published, and
  // bouncing to the index instead would be a soft-404 — a page that answers
  // 200 for a URL that has no content, which is worse for indexing than the
  // honest 404.
  if (!p) notFound();

  permanentRedirect(`/ecosystem/${p.slug}`);
}
