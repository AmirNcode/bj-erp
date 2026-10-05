'use client';

import { useTransition } from 'react';
import { useRouter, usePathname } from '@/i18n/navigation';
import { updateMyPrefs } from '@/lib/actions/profile';
import { cn } from '@/lib/utils';

type Props = {
  locale: string;
  labels: { label: string; fa: string; en: string };
  /** Test-id prefix for the two buttons (`${prefix}-fa`, `${prefix}-en`). */
  testIdPrefix?: string;
  className?: string;
};

/**
 * fa / en segmented switch: saves the preference, then swaps the locale of the
 * current page. Used in the side panel and on the Profile page (the mobile
 * path, where there is no side panel).
 */
export function LanguageSwitch({ locale, labels, testIdPrefix = 'nav-lang', className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const choose = (next: 'fa' | 'en') => {
    if (next === locale || isPending) return;
    startTransition(async () => {
      await updateMyPrefs({ languagePref: next });
      router.replace(pathname, { locale: next });
    });
  };

  const options = [
    { value: 'fa' as const, label: labels.fa, dir: 'rtl' },
    { value: 'en' as const, label: labels.en, dir: 'ltr' },
  ];

  return (
    <div
      role="group"
      aria-label={labels.label}
      className={cn(
        'grid grid-cols-2 gap-0.5 rounded-[10px] border border-muted bg-background p-[3px]',
        className
      )}
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
              'h-7 whitespace-nowrap rounded-lg text-[12.5px] transition-colors disabled:opacity-60',
              active
                ? 'bg-card font-semibold text-primary shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
