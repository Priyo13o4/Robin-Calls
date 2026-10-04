/**
 * What an admin server action hands back.
 *
 * Actions RETURN their failure rather than throwing it. Next redacts the
 * message of an uncaught Server Action error in production, so a thrown
 * `"token_sale_address" must be 0x…` reaches the operator as "An error occurred
 * in the Server Components render" — the validation text, which is the entire
 * value of the message, is exactly the part that gets stripped. Returning it
 * keeps it intact in the environment that matters.
 */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * Wraps an action body so its throws become returns.
 *
 * Existing actions validate by throwing, and rewriting 36 of those into early
 * returns would be a large diff over code that is already correct. This keeps
 * `throw new Error("…")` as the way to reject, and converts at the boundary.
 *
 * SAFE only because no admin action calls `redirect()` or `notFound()`: those
 * signal by throwing, and this would swallow them into a failure toast. Check
 * before adding one.
 *
 * @param work May return the success sentence. When it returns nothing, the
 *        form's own `successMessage` is used.
 */
export async function toResult(work: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await work();
    return { ok: true, message: message || undefined };
  } catch (error) {
    // A thrown Error here is OUR validation message, written for the operator.
    // Anything else is a fault we cannot describe, and must not be pasted raw.
    return {
      ok: false,
      error: error instanceof Error && error.message ? error.message : "The change could not be saved.",
    };
  }
}
