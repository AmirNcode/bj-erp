'use client';

import { useEffect, useState } from 'react';
import { buildCsv } from '@/lib/csv/parse';
import type { IssuedCredential } from '@/lib/actions/employees';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Props = {
  credentials: IssuedCredential[];
  labels: {
    title: string;
    warn: string;
    download: string;
    name: string;
    code: string;
    password: string;
  };
};

/**
 * One-time credentials screen: table + CSV download. Passwords exist only in
 * this component's props — they are bcrypt-hashed in the DB and cannot be
 * exported again later, so the page warns before it is left undownloaded.
 */
export function CredentialsDownload({ credentials, labels }: Props) {
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    if (downloaded) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [downloaded]);

  const download = () => {
    const rows = [
      [labels.name, labels.code, labels.password],
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
    setDownloaded(true);
  };

  return (
    <Card className="border-2 border-success/30 bg-success-foreground">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold text-success">{labels.title}</h2>
        <p
          role="alert"
          className="rounded-lg border border-warning/20 bg-warning-foreground px-4 py-3 text-sm text-warning"
        >
          {labels.warn}
        </p>
        <Button onClick={download} data-testid="credentials-download">
          {labels.download}
        </Button>
        <div className="overflow-x-auto rounded-lg border border-success/20 bg-background">
          <table className="w-full text-sm" data-testid="credentials-table">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className="text-start px-3 py-2 font-semibold">{labels.name}</th>
                <th className="text-start px-3 py-2 font-semibold">{labels.code}</th>
                <th className="text-start px-3 py-2 font-semibold">{labels.password}</th>
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
    </Card>
  );
}
