/**
 * The ONLY code in the extension that clicks anything on IndiaMART.
 *
 * It receives a button the Contact Buyer resolver has just verified and a
 * final guard from the action engine, re-checks the element one last time
 * in the same synchronous turn, and only then calls click(). Nothing else in
 * the codebase may call click() (enforced by a source-scan test).
 */

export type ClickOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly clicked: false; readonly reason: string }
  | { readonly ok: false; readonly clicked: true; readonly reason: string };

export function clickContactBuyer(
  button: Element,
  /** Returns a reason to refuse, or null when the click may proceed. */
  guard: () => string | null,
): ClickOutcome {
  const refusal = guard();
  if (refusal !== null) return { ok: false, clicked: false, reason: refusal };
  if (!(button instanceof HTMLElement)) {
    return { ok: false, clicked: false, reason: 'target is not a clickable element' };
  }
  if (!button.isConnected) return { ok: false, clicked: false, reason: 'button left the page' };
  if (button instanceof HTMLButtonElement && button.disabled) {
    return { ok: false, clicked: false, reason: 'button is disabled' };
  }
  try {
    button.click();
    return { ok: true };
  } catch (error) {
    // The click may have partly happened: reported as clicked, never retried.
    return {
      ok: false,
      clicked: true,
      reason: error instanceof Error ? error.message : 'click threw',
    };
  }
}
