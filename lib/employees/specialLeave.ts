/**
 * FR-65 marriage checkbox on the special-leave card. Pure.
 *
 * `maritalStatus` is `undefined` when the caller cannot read the target's
 * personal information (a special_leave holder without personal_info read):
 * unknown is not married, so the box stays offered and the RPC's own refusal
 * ("marriage leave needs marital status single", mapped in db-error) decides.
 * `null` means readable but not set, which the RPC refuses like "married".
 */
export function marriageOffer({
  granted,
  maritalStatus,
}: {
  granted: boolean;
  maritalStatus: string | null | undefined;
}): { enabled: boolean; hint: 'grantedOn' | 'marriageHint' | 'marriageNotSingle' } {
  if (granted) return { enabled: true, hint: 'grantedOn' };
  if (maritalStatus === undefined || maritalStatus === 'single') return { enabled: true, hint: 'marriageHint' };
  return { enabled: false, hint: 'marriageNotSingle' };
}
