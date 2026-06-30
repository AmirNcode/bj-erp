import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import '../globals.css';

const vazirmatn = localFont({
  src: './../fonts/Vazirmatn[wght].woff2',
  variable: '--font-vazirmatn',
  weight: '100 900',
  display: 'swap',
});

const rubik = localFont({
  src: [
    { path: './../fonts/Rubik-VariableFont_wght.ttf', style: 'normal', weight: '300 900' },
    { path: './../fonts/Rubik-Italic-VariableFont_wght.ttf', style: 'italic', weight: '300 900' },
  ],
  variable: '--font-rubik',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'سامانه منابع انسانی',
  description: 'HR Management System',
};

export const viewport: Viewport = {
  themeColor: '#2E3C92',
  colorScheme: 'light',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Enable static rendering
  setRequestLocale(locale);

  const messages = await getMessages();
  const dir = locale === 'fa' ? 'rtl' : 'ltr';

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${rubik.variable} ${vazirmatn.variable} h-full antialiased font-sans`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
