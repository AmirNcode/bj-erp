/**
 * Home: one line when clearance forms (FR-54) wait on the caller's signature.
 * The forms themselves live under Profile (spec D9); this is how a signer who
 * never opens Profile finds them (spec A7). Renders nothing at zero.
 */

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getClearanceSummary } from '@/lib/actions/clearance';
import { formatNumber } from '@/lib/i18n/format';

export async function ClearanceAwaitingCard({ locale }: { locale: string }) {
  const { awaiting } = await getClearanceSummary();
  if (awaiting === 0) return null;
  const t = await getTranslations('clearance.home');

  return (
    <Link
      href={`/${locale}/clearance`}
      className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning-foreground p-4 text-warning transition-colors hover:border-warning/50"
      data-testid="home-clearance-awaiting"
    >
      <span className="text-sm font-semibold">{t('awaiting', { count: formatNumber(awaiting, locale) })}</span>
      <span className="text-xs font-medium">{t('open')} ›</span>
    </Link>
  );
}
