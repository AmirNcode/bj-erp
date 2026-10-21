'use server';

/**
 * FR-70 travel booking for out-of-town daily errands. Every read and write goes
 * through guarded SECURITY DEFINER functions; `travel_bookings` and
 * `errand_extensions` have no client policies.
 */

import { requireCaller } from '@/lib/auth/context';
import { dbErr, type DbErrorResult } from '@/lib/errors/db-error';
import { invalidateAppCache } from '@/lib/cache/invalidate-app';
import type { TravellerField } from '@/lib/travel/fields';
import type { Itinerary } from '@/lib/travel/itinerary';
import type { Json } from '@/lib/supabase/types';

/** HR or admin: mark (or unmark) a daily errand «نیاز به رزرو سفر». */
export async function setTravelBooking(requestId: string, on: boolean): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { error } = await c.supabase.rpc('app_set_travel_booking', { p_request: requestId, p_on: on });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/** HR or admin: names of the traveller details still empty for this request. */
export async function getTravelMissingFields(
  requestId: string
): Promise<{ ok: true; fields: TravellerField[] } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_travel_missing_fields', { p_request: requestId });
  if (error) return dbErr(error.message);
  return { ok: true, fields: (data ?? []) as TravellerField[] };
}

/**
 * HR or admin: ticked requests and whether procurement has started on them.
 * `null` when the caller may not tick (the Requests page then shows no switch).
 */
export async function getTravelTicks(): Promise<Record<string, { started: boolean }> | null> {
  const c = await requireCaller();
  if (!c.ok) return null;
  const { data, error } = await c.supabase.rpc('app_travel_ticks');
  if (error) return null;
  return Object.fromEntries((data ?? []).map((r) => [r.request_id, { started: r.started }]));
}

export type TravelState = 'to_book' | 'extension' | 'done' | 'cancel_undo' | 'settled';
export type Transport = 'flight' | 'company_car';

export type TravelBookingRow = {
  request_id: string;
  serial_year: number;
  serial_seq: number;
  employee_name: string;
  personnel_no: string | null;
  department_name_fa: string | null;
  department_name_en: string | null;
  errand_location: string | null;
  start_date: string;
  end_date: string;
  state: TravelState;
  transport: Transport | null;
  flight_cost_rials: number | null;
  hotel_cost_rials: number | null;
  lost_rials: number | null;
  done_at: string | null;
};

export type TravelBookingDetail = Omit<TravelBookingRow, 'done_at'> & {
  description: string | null;
  status: 'approved' | 'cancelled';
  traveller_note: string | null;
  /** FR-73; null on bookings saved before it. */
  itinerary: Itinerary | null;
  lost_note: string | null;
  done_at: string | null;
  extensions: { old_end_date: string; new_end_date: string; reason: string; decided_at: string | null }[];
  /** Live from personal information; absent once the booking is closed. */
  traveller?: Partial<Record<TravellerField, string | null>>;
};

/** Procurement (travel_booking) or admin: every booking past HR approval, own trips excluded. */
export async function listTravelBookings(): Promise<{ ok: true; rows: TravelBookingRow[] } | DbErrorResult> {
  const c = await requireCaller({ perm: ['travel_booking', 'edit'] });
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_travel_bookings');
  if (error) return dbErr(error.message);
  return { ok: true, rows: (data ?? []) as TravelBookingRow[] };
}

export async function getTravelBooking(requestId: string): Promise<{ ok: true; booking: TravelBookingDetail } | DbErrorResult> {
  const c = await requireCaller({ perm: ['travel_booking', 'edit'] });
  if (!c.ok) return c;
  const { data, error } = await c.supabase.rpc('app_travel_booking', { p_request: requestId });
  if (error) return dbErr(error.message);
  return { ok: true, booking: data as unknown as TravelBookingDetail };
}

export type SaveTravelBookingInput = {
  requestId: string;
  transport: Transport | null;
  flightCostRials: number | null;
  hotelCostRials: number | null;
  itinerary: Itinerary;
  note: string;
  done: boolean;
};

const isRials = (v: number | null) => v === null || (Number.isSafeInteger(v) && v >= 0);

export async function saveTravelBooking(input: SaveTravelBookingInput): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller({ perm: ['travel_booking', 'edit'] });
  if (!c.ok) return c;
  if (!isRials(input.flightCostRials) || !isRials(input.hotelCostRials)) return dbErr('costs must be 0 or more');
  const { error } = await c.supabase.rpc('app_save_travel_booking_v2', {
    p_request: input.requestId,
    p_transport: input.transport,
    p_flight: input.flightCostRials,
    p_hotel: input.hotelCostRials,
    p_itinerary: input.itinerary as Json,
    p_note: input.note,
    p_done: input.done,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

export type MyTravel = {
  transport: Transport | null;
  note: string | null;
  /** FR-73; null on bookings finished before it. */
  itinerary?: Itinerary | null;
  pending?: boolean;
};

/**
 * The caller's own trips: transport, itinerary and procurement's note on
 * finished bookings (no costs), and `pending` on approved trips procurement has
 * still to book or re-book after an extension.
 */
export async function getMyTravelBookings(): Promise<Record<string, MyTravel>> {
  const c = await requireCaller();
  if (!c.ok) return {};
  const [booked, pending] = await Promise.all([
    c.supabase.rpc('my_travel_itineraries'),
    c.supabase.rpc('my_travel_pending'),
  ]);
  const out: Record<string, MyTravel> = {};
  if (!booked.error) {
    for (const r of booked.data ?? []) {
      out[r.request_id] = {
        transport: r.transport as Transport | null,
        note: r.traveller_note,
        itinerary: (r.itinerary as Itinerary | null) ?? null,
      };
    }
  }
  if (!pending.error) {
    for (const id of pending.data ?? []) out[id] = { ...(out[id] ?? { transport: null, note: null }), pending: true };
  }
  return out;
}

// ---------------------------------------------------------------- extensions (spec §6)

export type ExtendableTrip = {
  request_id: string;
  serial_year: number;
  serial_seq: number;
  employee_name: string;
  errand_location: string | null;
  start_date: string;
  end_date: string;
  pending_extension: boolean;
  /** A temporary approval delegation was set from this trip; it will not cover the extra days. */
  delegation_uncovered: boolean;
  /** The Head of HR's own trip (HR step exempt): the extension applies at once, no HR decision. */
  hr_exempt: boolean;
};

export type PendingExtension = {
  extension_id: string;
  request_id: string;
  serial_year: number;
  serial_seq: number;
  employee_name: string;
  errand_location: string | null;
  start_date: string;
  old_end_date: string;
  new_end_date: string;
  reason: string;
  requested_by_name: string;
  per_diem_rials: number | null;
  /** A temporary approval delegation was set from this trip; the extra days are not covered. */
  delegation_uncovered: boolean;
};

export type RequestExtension = {
  old_end_date: string;
  new_end_date: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  evidence: 'manual' | 'exempt' | null;
  requested_by_name: string;
  decided_by_name: string | null;
  decided_at: string | null;
};

/** Direct manager (admin: company): approved travel-booked trips not yet ended. */
export async function listExtendableTrips(): Promise<ExtendableTrip[]> {
  const c = await requireCaller();
  if (!c.ok) return [];
  const { data, error } = await c.supabase.rpc('app_extendable_trips');
  if (error) return [];
  return (data ?? []) as ExtendableTrip[];
}

export async function requestExtension(input: { requestId: string; newEndDate: string; reason: string }): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (!input.reason.trim()) return dbErr('a reason is required');
  const { error } = await c.supabase.rpc('app_request_errand_extension', {
    p_request: input.requestId, p_new_end: input.newEndDate, p_reason: input.reason,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/** hr and admin: extensions waiting for a decision (own trips excluded). */
export async function listPendingExtensions(): Promise<PendingExtension[]> {
  const c = await requireCaller();
  if (!c.ok) return [];
  const { data, error } = await c.supabase.rpc('app_pending_errand_extensions');
  if (error) return [];
  return (data ?? []) as PendingExtension[];
}

export async function decideExtension(input: {
  extensionId: string;
  approve: boolean;
  signatureData: string | null;
  signatureAuthorized: boolean;
  perDiemRials: number | null;
  note: string;
}): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller();
  if (!c.ok) return c;
  if (input.approve && (!input.signatureData || !input.signatureAuthorized)) return dbErr('signature is required');
  if (input.perDiemRials !== null && (!Number.isSafeInteger(input.perDiemRials) || input.perDiemRials < 0)) {
    return dbErr('per diem must be 0 or more');
  }
  const { error } = await c.supabase.rpc('app_decide_errand_extension', {
    p_extension: input.extensionId,
    p_approve: input.approve,
    p_signature_data: input.signatureData,
    p_signature_authorized: input.signatureAuthorized,
    p_per_diem_rials: input.perDiemRials,
    p_note: input.note,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}

/** Procurement: after a cancellation, record what could not be refunded (0 allowed). */
export async function settleTravelBooking(input: { requestId: string; lostRials: number; note: string }): Promise<{ ok: true } | DbErrorResult> {
  const c = await requireCaller({ perm: ['travel_booking', 'edit'] });
  if (!c.ok) return c;
  if (!Number.isSafeInteger(input.lostRials) || input.lostRials < 0) return dbErr('amount lost must be 0 or more');
  const { error } = await c.supabase.rpc('app_settle_travel_booking', {
    p_request: input.requestId, p_lost: input.lostRials, p_note: input.note,
  });
  if (error) return dbErr(error.message);
  invalidateAppCache();
  return { ok: true };
}
