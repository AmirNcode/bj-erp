'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye } from 'lucide-react';
import { endViewAs } from '@/lib/actions/view-as';
import { msUntilExpiry, postViewAsChange, viewAsLabel } from '@/lib/view-as/client';
import { LanguageSwitch } from './LanguageSwitch';
import { useViewAs } from './ViewAsContext';

/** FR-86: amber strip at the top of every app page while an admin views as someone. */
export function ViewAsBar({ locale }: { locale: string }) {
  const t = useTranslations('viewAs');
  const view = useViewAs();
  const [leaving, setLeaving] = useState(false);
  const expiresAt = view?.expiresAt;

  useEffect(() => {
    if (!expiresAt) return;
    const delay = msUntilExpiry(expiresAt, Date.now());
    if (!Number.isFinite(delay)) return;
    const id = window.setTimeout(
      // Full navigation on purpose: the cleared view must reach the server, not the router cache.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      () => window.location.assign(`/api/view-as/clear?locale=${locale}`),
      delay
    );
    return () => window.clearTimeout(id);
  }, [expiresAt, locale]);

  if (!view) return null;

  const exit = async () => {
    if (leaving) return;
    setLeaving(true);
    try {
      await endViewAs();
    } catch {
      /* still leave: the next page load shows the true state */
    } finally {
      postViewAsChange();
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/${locale}/admin/view-as`);
    }
  };

  return (
    <div
      data-testid="view-as-bar"
      className="sticky top-0 z-40 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/40 bg-warning-foreground px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-warning print:hidden"
    >
      <Eye className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 text-sm font-semibold">
        {t('viewing', { person: viewAsLabel(view.name, view.personnelNo) })}
        <span className="ms-2 rounded-full border border-warning/40 px-2 py-0.5 text-xs font-medium">{t('readOnly')}</span>
      </span>
      <LanguageSwitch locale={locale} testIdPrefix="view-as-lang" className="w-28" />
      <button
        type="button"
        data-testid="view-as-exit"
        disabled={leaving}
        onClick={exit}
        className="h-8 rounded-lg bg-warning px-3 text-sm font-semibold text-warning-foreground disabled:opacity-60"
      >
        {t('exit')}
      </button>
    </div>
  );
}
