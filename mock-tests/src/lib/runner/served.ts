/**
 * The client-side ledger for served items.
 *
 * Kept as a pure module (no React, no fetch) for one reason: this is the piece
 * that decides whether exposure data is COMPLETE, and completeness is not
 * something a browser test asserts well. Every failure here is silent - an item
 * reported twice inflates exposure, an item never reported makes a served item
 * look unserved and re-creates the exact gap migration 122 exists to close.
 *
 * THE THREE INVARIANTS, each asserted in scripts/served-items.test.mts:
 *   1. An id that has been reported is never reported again - `seen` outlives
 *      `pending` precisely so a re-visit costs nothing.
 *   2. An id stays pending until the server accepts it. A failed beacon is
 *      retried on the next navigation, not dropped.
 *   3. Nothing is forgotten on a resume. The ledger starts empty, so a resumed
 *      attempt re-reports the items it has already viewed - which is correct and
 *      free, because the server's primary key absorbs them.
 */

export interface ServedLedger {
  /** Every id ever handed to the ledger. Reported or pending. */
  seen: Set<string>
  /** Viewed, not yet accepted by the server. Ordered for deterministic tests. */
  pending: string[]
}

export function createServedLedger(): ServedLedger {
  return { seen: new Set(), pending: [] }
}

/**
 * Record ids as displayed. Ids already seen are ignored, so calling this on
 * every render or navigation is safe.
 */
export function noteServed(ledger: ServedLedger, ids: string | string[] | null | undefined): void {
  if (!ids) return
  const list = Array.isArray(ids) ? ids : [ids]
  for (const id of list) {
    if (!id || ledger.seen.has(id)) continue
    ledger.seen.add(id)
    ledger.pending.push(id)
  }
}

/** The delta to send now. Empty means there is nothing to do. */
export function pendingServed(ledger: ServedLedger): string[] {
  return ledger.pending
}

/**
 * Called only after the server accepted the batch. Anything that arrived while
 * the request was in flight stays pending, which is why this takes the ids that
 * were SENT rather than clearing the whole list.
 */
export function markServedSent(ledger: ServedLedger, ids: string[]): void {
  if (ids.length === 0) return
  const sent = new Set(ids)
  ledger.pending = ledger.pending.filter((id) => !sent.has(id))
}

/** Total ids ever viewed, for a diagnostic that never grows unbounded in output. */
export function servedCount(ledger: ServedLedger): number {
  return ledger.seen.size
}
