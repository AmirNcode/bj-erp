'use client';

import { useTransition } from 'react';
import { useRouter, usePathname } from '@/i18n/navigation';
import { updateMyPrefs } from '@/lib/actions/profile';
import { cn } from '@/lib/utils';

type Props = {
  locale: string;
  labels: { label: string; fa: string; en: string };
};

/**
 * Side-panel language switch. Same save-then-switch logic as the Profile
 * page's select (profile/SettingsForm.tsx), which stays as the mobile path.
 */
export function LanguageSwitch({ locale, labels }: Props) {
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
      className="grid grid-cols-2 gap-0.5 rounded-[10px] border border-muted bg-background p-[3px]"
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
            data-testid={`nav-lang-${opt.value}`}
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
