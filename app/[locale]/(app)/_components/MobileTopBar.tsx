'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { sectionFor } from '@/lib/nav/sectionFor';

/**
 * Phone-only top bar (Blueprint): the section name at the start, the company
 * logo at the end (right in English, left in Farsi). Same blue as the desktop
 * side panel, which is the logo's own blue.
 */
export function MobileTopBar({ locale, appName }: { locale: string; appName: string }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const path = pathname.startsWith(`/${locale}`) ? pathname.slice(locale.length + 1) : pathname;
  const section = sectionFor(path);
  const name = section ? t(section.key) : appName;

  return (
    <header
      data-testid="mobile-top-bar"
      className="flex items-center justify-between gap-3 bg-sidebar px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-sidebar-foreground md:hidden print:hidden"
    >
      {section ? (
        <Link
          href={`/${locale}${section.href}`}
          aria-label={t('goTo', { section: name })}
          data-testid="mobile-section-link"
          className="inline-flex min-w-0 items-center gap-1 rounded-md border border-white/40 px-2.5 py-1 text-lg font-semibold hover:bg-white/10 active:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        >
          <ChevronLeft aria-hidden className="size-4 shrink-0 rtl:rotate-180" />
          <span className="truncate">{name}</span>
        </Link>
      ) : (
        <span className="min-w-0 truncate text-lg font-semibold">{name}</span>
      )}
      <Link href={`/${locale}/home`} aria-label={t('home')} data-testid="mobile-logo-link" className="shrink-0">
      <Image
        src="/bj-logo.png"
        alt={appName}
        width={1181}
        height={591}
        sizes="72px"
        className="h-9 w-auto shrink-0 bg-[linear-gradient(white,white)] bg-[length:calc(100%-4px)_calc(100%-4px)] bg-center bg-no-repeat"
      />
      </Link>
    </header>
  );
}
