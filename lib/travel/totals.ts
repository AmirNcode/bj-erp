/**
 * FR-70: what one /finance row costs the company. A booked trip is per diem +
 * ticket + hotel; a cancelled one is only what was lost. Missing amounts are 0.
 */

type CostRow = {
  status: string;
  per_diem_rials: number | null;
  flight_cost_rials: number | null;
  hotel_cost_rials: number | null;
  lost_rials: number | null;
};

export function tripTotal(row: CostRow): number {
  if (row.status === 'cancelled') return row.lost_rials ?? 0;
  return (row.per_diem_rials ?? 0) + (row.flight_cost_rials ?? 0) + (row.hotel_cost_rials ?? 0);
}
