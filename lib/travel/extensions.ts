/**
 * FR-70 / FR-84 print form: the requester and approvers signed the original dates
 * and per diem, so the paper form prints those, then one line per later change in
 * time order: approved extensions and HR corrections mixed. Pure.
 */

type Extension = { old_end_date: string; new_end_date: string; reason: string; status: string; decided_at: string | null };

export type RequestCorrection = {
  old_start_date: string;
  new_start_date: string;
  old_end_date: string;
  new_end_date: string;
  per_diem_before: number | null;
  per_diem_after: number | null;
  reason: string;
  corrected_by_name: string | null;
  corrected_at: string;
};

export type TripChange = {
  kind: 'extension' | 'correction';
  at: string;
  start: string;
  end: string;
  perDiem: number | null;
  /** Whether this change moved the dates, and the per diem (a correction may do either). */
  datesChanged: boolean;
  perDiemChanged: boolean;
  reason: string;
};

type Event =
  | { kind: 'extension'; at: string; oldEnd: string; row: Extension }
  | { kind: 'correction'; at: string; oldEnd: string; row: RequestCorrection };

export function printedTripDates(
  trip: { start: string; end: string; perDiem: number | null },
  extensions: Extension[],
  corrections: RequestCorrection[]
): { signedStart: string; signedEnd: string; signedPerDiem: number | null; changes: TripChange[] } {
  const events: Event[] = [
    ...extensions
      .filter((e) => e.status === 'approved')
      .map((row) => ({ kind: 'extension' as const, at: row.decided_at ?? '', oldEnd: row.old_end_date, row })),
    ...corrections.map((row) => ({ kind: 'correction' as const, at: row.corrected_at, oldEnd: row.old_end_date, row })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const first = corrections[0];
  const signedStart = first?.old_start_date ?? trip.start;
  const signedPerDiem = first ? first.per_diem_before : trip.perDiem;

  // Walk forward from the signed values: an extension moves only the end.
  let start = signedStart;
  let perDiem = signedPerDiem;
  const changes = events.map((e): TripChange => {
    const end = e.row.new_end_date;
    const base = { kind: e.kind, at: e.at, end, reason: e.row.reason };
    if (e.kind === 'correction') {
      const datesChanged = e.row.new_start_date !== e.row.old_start_date || end !== e.oldEnd;
      const perDiemChanged = e.row.per_diem_after !== e.row.per_diem_before;
      start = e.row.new_start_date;
      perDiem = e.row.per_diem_after;
      return { ...base, start, perDiem, datesChanged, perDiemChanged };
    }
    return { ...base, start, perDiem, datesChanged: true, perDiemChanged: false };
  });

  return { signedStart, signedEnd: events[0]?.oldEnd ?? trip.end, signedPerDiem, changes };
}

/** FR-84: which rows offer Correct. The caller must also pass the HR gate. */
export function canCorrectTrip(
  r: { kind: string; unit: string; status: string; employee_id: string },
  viewerId: string
): boolean {
  return r.kind === 'errand' && r.unit === 'day' && r.status === 'approved' && r.employee_id !== viewerId;
}
