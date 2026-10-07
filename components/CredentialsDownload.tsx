'use client';

import { useEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslations } from 'next-intl';
import { buildCsv } from '@/lib/csv/parse';
import type { IssuedCredential } from '@/lib/actions/employees';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  credentials: IssuedCredential[];
};

/**
 * One-time credentials screen: table, CSV download and printable login slips.
 * Passwords exist only in this component's props — they are bcrypt-hashed in
 * the DB and cannot be exported again later, so the page warns before it is
 * left without a download or a print.
 */
export function CredentialsDownload({ credentials }: Props) {
  const t = useTranslations('manage.import.credentials');
  const [saved, setSaved] = useState(false);
  // The host printed on each slip, read when printing (bjeng.app in production).
  const [printHost, setPrintHost] = useState<string | null>(null);

  useEffect(() => {
    if (saved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saved]);

  useEffect(() => () => document.documentElement.classList.remove('print-slips'), []);

  const download = () => {
    const rows = [
      [t('name'), t('code'), t('password')],
      ...credentials.map((c) => [c.fullName, c.employeeCode, c.password]),
    ];
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bj-credentials-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  // The slips must be in the DOM before the dialog opens, hence flushSync. The
  // class makes the printout hold only the slips (app/globals.css).
  const printSlips = () => {
    setSaved(true);
    flushSync(() => setPrintHost(window.location.host));
    const root = document.documentElement;
    root.classList.add('print-slips');
    window.addEventListener(
      'afterprint',
      () => {
        root.classList.remove('print-slips');
        setPrintHost(null);
      },
      { once: true }
    );
    window.print();
  };

  return (
    <Card className="border-2 border-success/30 bg-success-foreground">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold text-success">{t('title')}</h2>
        <p
          role="alert"
          className="rounded-lg border border-warning/20 bg-warning-foreground px-4 py-3 text-sm text-warning"
        >
          {t('warn')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={download} data-testid="credentials-download">
            {t('download')}
          </Button>
          <Button variant="outline" onClick={printSlips} data-testid="credentials-print-slips">
            {t('printSlips')}
          </Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-success/20 bg-background">
          <table className="w-full text-sm" data-testid="credentials-table">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-start px-3 py-2 font-semibold">{t('name')}</th>
                <th className="text-start px-3 py-2 font-semibold">{t('code')}</th>
                <th className="text-start px-3 py-2 font-semibold">{t('password')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {credentials.map((c) => (
                <tr key={c.employeeCode}>
                  <td className="px-3 py-2">{c.fullName}</td>
                  <td className="px-3 py-2 font-mono" dir="ltr">{c.employeeCode}</td>
                  <td className="px-3 py-2 font-mono select-all" dir="ltr">{c.password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
      {printHost !== null &&
        createPortal(
          <div
            id="credential-slips"
            data-testid="credential-slips"
            className="hidden print:grid grid-cols-2 gap-4 bg-white p-2 text-black"
          >
            {credentials.map((c) => (
              <div
                key={c.employeeCode}
                className="break-inside-avoid space-y-2 rounded border-2 border-dashed p-4 text-sm"
                // Inline: the unlayered `* { border-color }` rule in globals.css beats utilities.
                style={{ borderColor: '#000' }}
              >
                <p className="font-bold">{t('slipTitle')}</p>
                <p className="text-base font-semibold">{c.fullName}</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt>{t('slipAddress')}</dt>
                  <dd className="font-mono" dir="ltr">{printHost}</dd>
                  <dt>{t('code')}</dt>
                  <dd className="font-mono text-base font-bold" dir="ltr">{c.employeeCode}</dd>
                  <dt>{t('slipPassword')}</dt>
                  <dd className="font-mono text-base font-bold" dir="ltr">{c.password}</dd>
                </dl>
                <p className="text-xs">{t('slipNote')}</p>
              </div>
            ))}
          </div>,
          document.body
        )}
    </Card>
  );
}
