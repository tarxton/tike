/**
 * Ids the page exposes so other parts of the app can move the reader to them.
 *
 * Shared through a constant rather than written twice, because a scroll target that
 * silently stops matching its element fails without any error — the page simply does
 * not move, which reads as the feature never having worked.
 */
export const RESULTS_ANCHOR = 'rezultati';
