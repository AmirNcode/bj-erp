'use client';

// Root wrapper for designs built with the bj components. Mirrors app/[locale]/layout.tsx:
// Radix direction provider + next-intl messages + the html-level dir/lang/font-sans setup
// (sets dir/lang on <html> too, as the app layout does).
import { useLayoutEffect, type ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { Direction } from 'radix-ui';
import { personSearch as faPersonSearch } from '../messages/fa.json';
import { personSearch as enPersonSearch } from '../messages/en.json';

export function BjProvider({ locale = 'fa', children }: { locale?: 'fa' | 'en'; children?: ReactNode }) {
  const dir = locale === 'fa' ? 'rtl' : 'ltr';
  const messages = { personSearch: locale === 'fa' ? faPersonSearch : enPersonSearch };
  // Like the app's <html dir lang>: portalled overlays (Dialog, AlertDialog, Toaster) mount on
  // <body>, outside the wrapper div, and must still be RTL.
  useLayoutEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = locale;
  }, [dir, locale]);
  return (
    <Direction.Provider dir={dir}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Tehran">
        <div dir={dir} lang={locale} className="font-sans antialiased text-foreground">
          {children}
        </div>
      </NextIntlClientProvider>
    </Direction.Provider>
  );
}
