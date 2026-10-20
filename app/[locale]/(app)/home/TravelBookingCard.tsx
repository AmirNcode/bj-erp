/**
 * Home: one line for procurement (FR-70) when trips wait on them — to book, an
 * extension to update, or a cancellation to undo. Renders nothing at zero or
 * without the travel_booking permission.
 */

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { listTravelBookings } from '@/lib/actions/travel';

export async function TravelBookingCard({ locale, userId }: { locale: string; userId: string }) {
  if (!can(await getCachedPermissions(userId), 'travel_booking', 'edit')) return null;
  const result = await listTravelBookings();
  if (!result.ok) return null;
  const waiting = result.rows.filter((r) => r.state === 'to_book' || r.state === 'extension' || r.state === 'cancel_undo').length;
  if (waiting === 0) return null;
  const t = await getTranslations('travel');

  return (
    <Link
      href={`/${locale}/procurement`}
      className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-foreground p-4 text-warning transition-colors hover:border-warning/50"
      data-testid="home-travel-booking"
    >
      <span className="text-sm font-semibold">{t('homeWaiting', { count: waiting })}</span>
      <span className="text-xs font-medium">{t('homeOpen')} ›</span>
    </Link>
  );
}
