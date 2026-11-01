/**
 * One help guide. The content is trusted static markup from lib/help/*,
 * styled by `.help-guide` in app/globals.css, and always shown in its own language.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { findGuide } from '@/lib/help/guides';
import { cn } from '@/lib/utils';
import { PageHeader } from '../../_components/PageHeader';

type Props = { params: Promise<{ locale: string; slug: string }> };

export default async function HelpGuidePage({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const guide = findGuide(slug);
  if (!guide) notFound();
  const t = await getTranslations('help');
  const dir = guide.lang === 'fa' ? 'rtl' : 'ltr';

  return (
    <main className="mx-auto w-full max-w-3xl p-4 md:p-6">
      <Link
        href={`/${locale}/help`}
        data-testid="help-back"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden className="rtl:rotate-180">
          ‹
        </span>
        {t('back')}
      </Link>
      <PageHeader
        title={t(`${guide.messageKey}.title`)}
        action={
          guide.pdf && (
            <a
              href={guide.pdf}
              download
              data-testid="help-pdf"
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              {t('downloadPdf')}
            </a>
          )
        }
      />

      <div lang={guide.lang} dir={dir}>
        <details className="mb-2 rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-semibold">{t('contents')}</summary>
          <ol className="mt-2 space-y-1 text-sm">
            {guide.toc.map((item) => (
              <li key={item.id} className={cn(item.level === 3 && 'ps-5 text-muted-foreground')}>
                <a href={`#${item.id}`} className="hover:text-primary hover:underline">
                  {item.text}
                </a>
              </li>
            ))}
          </ol>
        </details>
        <article
          className="help-guide"
          data-testid="help-guide-content"
          dangerouslySetInnerHTML={{ __html: guide.html }}
        />
      </div>
    </main>
  );
}
