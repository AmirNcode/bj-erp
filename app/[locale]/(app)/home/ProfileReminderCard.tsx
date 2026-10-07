'use client';

/**
 * Home nudge (FR-52/FR-53): finish personal information and save a signature.
 * Optional, never blocking. Dismissal is a per-browser convenience
 * (localStorage, 14 days); storage that throws just means it shows again.
 */

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';

const KEY = 'bj.profileReminder.dismissedAt';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

function snoozed(): boolean {
  try {
    const at = Number(window.localStorage.getItem(KEY) ?? 0);
    return !!at && Date.now() - at < SNOOZE_MS;
  } catch {
    return false; // storage unavailable: show it
  }
}

const noSubscribe = () => () => {};

export function ProfileReminderCard({
  locale,
  needsInfo,
  needsSignature,
}: {
  locale: string;
  needsInfo: boolean;
  needsSignature: boolean;
}) {
  const t = useTranslations('home.profileReminder');
  // Server render says "snoozed", so a dismissed card never flashes in.
  const wasSnoozed = useSyncExternalStore(noSubscribe, snoozed, () => true);
  const [dismissed, setDismissed] = useState(false);

  if (wasSnoozed || dismissed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      className="mb-5 flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4"
      data-testid="profile-reminder"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold">{t('title')}</p>
        <p className="text-xs text-muted-foreground">
          {needsInfo && needsSignature ? t('both') : needsInfo ? t('info') : t('signature')}
        </p>
        <div className="flex flex-wrap gap-3 pt-1 text-sm">
          {needsInfo && (
            <Link href={`/${locale}/profile/personal-info`} className="font-medium text-primary hover:underline">
              {t('infoLink')}
            </Link>
          )}
          {needsSignature && (
            <Link href={`/${locale}/profile`} className="font-medium text-primary hover:underline">
              {t('signatureLink')}
            </Link>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dismiss')}
        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        data-testid="profile-reminder-dismiss"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
