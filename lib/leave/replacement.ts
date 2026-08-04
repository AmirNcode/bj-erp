/** Replacement/cover candidate returned by the availability-aware SQL reader. */

export type ReplacementCandidate = {
  profileId: string;
  fullName: string;
  employeeCode: string;
  unavailable: boolean;
  /** Stable English key from SQL ('on leave'), localized by the UI. */
  unavailableReason: string | null;
};
