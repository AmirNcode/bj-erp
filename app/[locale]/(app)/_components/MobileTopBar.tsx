'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

// Longest match wins, so `/manage/approval-steps` never reads as Approvals.
const SECTIONS = [
  ['/manage/approval-steps', 'approvalSteps'],
  ['/manage/employees', 'employees'],
  ['/manage/departments', 'departments'],
  ['/manage/approvals', 'approvals'],
  ['/manage/reports', 'reports'],
  ['/manage', 'manage'],
  ['/absences', 'absences'],
  ['/finance', 'finance'],
  ['/procurement', 'procurement'],
  ['/settings', 'settings'],
  ['/admin', 'admin'],
  ['/help', 'help'],
  ['/profile', 'profile'],
  ['/home', 'home'],
  ['/request', 'request'],
  ['/calendar', 'calendar'],
  ['/organization', 'organization'],
] as const;

/**
 * Phone-only top bar (Blueprint): the section name at the start, the company
 * logo at the end (right in English, left in Farsi). Same blue as the desktop
 * side panel, which is the logo's own blue.
 */
export function MobileTopBar({ locale, appName }: { locale: string; appName: string }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const path = pathname.startsWith(`/${locale}`) ? pathname.slice(locale.length + 1) : pathname;
  const section = SECTIONS.find(([href]) => path === href || path.startsWith(`${href}/`));

  return (
    <header
      data-testid="mobile-top-bar"
      className="flex items-center justify-between gap-3 bg-sidebar px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] text-sidebar-foreground md:hidden print:hidden"
    >
      <span className="min-w-0 truncate text-[17px] font-semibold">{section ? t(section[1]) : appName}</span>
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
