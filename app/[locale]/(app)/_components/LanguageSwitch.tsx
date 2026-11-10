'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { updateMyPrefs } from '@/lib/actions/profile';
import { useViewAs } from './ViewAsContext';
import { cn } from '@/lib/utils';

type Props = {
  locale: string;
  /** Test-id prefix for the two buttons (`${prefix}-fa`, `${prefix}-en`). */
  testIdPrefix?: string;
  /** On the blue side panel: white text instead of ink. */
  onDark?: boolean;
  className?: string;
};

/**
 * fa / en text switch (the current one is bold and underlined): saves the preference, then swaps the locale of the
 * current page. Used in the side panel and on the Profile page (the mobile
 * path, where there is no side panel).
 */
export function LanguageSwitch({ locale, testIdPrefix = 'nav-lang', onDark, className }: Props) {
  const t = useTranslations('profile');
  const router = useRouter();
  const pathname = usePathname();
  const viewing = useViewAs() !== null;
  const [isPending, startTransition] = useTransition();

  const choose = (next: 'fa' | 'en') => {
    if (next === locale || isPending) return;
    startTransition(async () => {
      // View as: the target's preference is never written.
      if (!viewing) await updateMyPrefs({ languagePref: next });
      router.replace(pathname, { locale: next });
    });
  };

  const options = [
    { value: 'fa' as const, label: t('langFa'), dir: 'rtl' },
    { value: 'en' as const, label: t('langEn'), dir: 'ltr' },
  ];

  return (
    <div
      role="group"
      aria-label={t('language')}
      className={cn('flex items-center gap-4 px-1', className)}
    >
      {options.map((opt) => {
        const active = opt.value === locale;
        return (
          <button
            key={opt.value}
            type="button"
            lang={opt.value}
            dir={opt.dir}
            aria-pressed={active}
            disabled={isPending}
            data-testid={`${testIdPrefix}-${opt.value}`}
            onClick={() => choose(opt.value)}
            className={cn(
              'h-8 whitespace-nowrap text-[13px] underline-offset-[6px] transition-colors disabled:opacity-60',
              active && 'font-semibold underline decoration-2',
              onDark
                ? active ? 'text-white' : 'text-white/70 hover:text-white'
                : active ? 'text-foreground decoration-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
