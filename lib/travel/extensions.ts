/**
 * FR-70 print form: the requester and approvers signed the original end date, so
 * the paper form prints that date and one "extended to …" line per approved
 * extension (spec §6). Pure.
 */

type Extension = { old_end_date: string; new_end_date: string; reason: string; status: string };

export function printedTripDates(
  endDate: string,
  extensions: Extension[]
): { signedEnd: string; extended: { date: string; reason: string }[] } {
  const approved = extensions.filter((e) => e.status === 'approved');
  return {
    signedEnd: approved[0]?.old_end_date ?? endDate,
    extended: approved.map((e) => ({ date: e.new_end_date, reason: e.reason })),
  };
}
