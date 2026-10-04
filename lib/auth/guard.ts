import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

/**
 * Authoritative admin check for server components and server actions.
 * Verifies a real session AND role === "admin". Redirects to login otherwise.
 * The middleware is only a cheap edge pre-filter; this is the real gate.
 */
export async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/admin/login");
  }
  if ((session.user as { role?: string }).role !== "admin") {
    redirect("/admin/login?error=forbidden");
  }
  return session;
}
