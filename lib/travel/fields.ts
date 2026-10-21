/**
 * FR-70 traveller details procurement sees, and HR is warned about when missing.
 * PLACEHOLDER until procurement confirms the list. Mirrors
 * `private.travel_traveller_fields()`; tests/unit/travel-fields.test.ts keeps the
 * two in step. Labels and order only: whether a field is missing is decided in SQL
 * (`app_travel_missing_fields`).
 */
export const TRAVELLER_FIELDS = ['full_name', 'national_id', 'birth_date', 'mobile', 'gender'] as const;
export type TravellerField = (typeof TRAVELLER_FIELDS)[number];
