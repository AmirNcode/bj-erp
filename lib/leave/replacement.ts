/**
 * Pure helpers for the replacement/cover picker (spec §8).
 */

export type ReplacementCandidate = {
  profileId: string;
  fullName: string;
  employeeCode: string;
  unavailable: boolean;
  /** Stable English key from SQL ('on leave'), localized by the UI. */
  unavailableReason: string | null;
};

/**
 * Case-insensitive match on name or employee code.
 *
 * Unavailable candidates are deliberately KEPT: the picker renders them disabled
 * with their reason, so a worker who cannot find their intended cover is told
 * "on leave" instead of facing an unexplained gap in the list.
 */
export function filterCandidates(
  candidates: ReplacementCandidate[],
  query: string
): ReplacementCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return candidates;
  return candidates.filter(
    (c) =>
      c.fullName.toLowerCase().includes(q) || c.employeeCode.toLowerCase().includes(q)
  );
}
