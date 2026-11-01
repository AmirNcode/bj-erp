/**
 * Help & guides: guides, instructions and how-tos for every signed-in user.
 * Desktop reaches it from the side panel footer; mobile from the Profile screen.
 */
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HELP_GUIDES } from '@/lib/help/guides';
import { PageHeader } from '../_components/PageHeader';

type Props = { params: Promise<{ locale: string }> };

export default async function HelpPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('help');

  return (
    <main className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <PageHeader title={t('title')} />
      <p className="mb-4 text-sm text-muted-foreground">{t('intro')}</p>
      <ul className="space-y-3">
        {HELP_GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link
              href={`/${locale}/help/${guide.slug}`}
              data-testid={`help-guide-${guide.slug}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span>
                <span className="block text-sm font-semibold">{t(`${guide.messageKey}.title`)}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`${guide.messageKey}.description`)}
                </span>
                {guide.lang !== locale && (
                  <span className="mt-1.5 inline-block rounded-full bg-muted px-2 text-[11.5px] text-muted-foreground">
                    {t('persianOnly')}
                  </span>
                )}
              </span>
              <span aria-hidden className="text-muted-foreground rtl:rotate-180">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
