'use client';

/**
 * Personal-info CSV export and import (FR-53). The export header is the import
 * header, so HR can download, fill in Excel and upload the same file. An empty
 * cell leaves the stored value alone; the whole import is one transaction.
 */

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { buildCsv, parseCsv } from '@/lib/csv/parse';
import {
  exportPersonalInfo,
  getImportablePersonnelNos,
  importPersonalInfo,
} from '@/lib/actions/personal-info';
import {
  personalInfoCsvRow,
  personalInfoHeader,
  validatePersonalInfoCsv,
  type PersonalInfoImportError,
  type PersonalInfoImportRow,
} from '@/lib/personal-info/csv';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function download(rows: string[][], name: string) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PersonalInfoBulk({ locale }: { locale: string }) {
  const t = useTranslations('personalInfo.bulk');
  const tf = useTranslations('personalInfo.fields');
  const tp = useTranslations('personalInfo.problems');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<{ rows: PersonalInfoImportRow[]; errors: PersonalInfoImportError[] } | null>(
    null
  );
  const [done, setDone] = useState<number | null>(null);

  const onExport = () =>
    startTransition(async () => {
      setError('');
      const res = await exportPersonalInfo();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      download([personalInfoHeader(), ...res.rows.map((r) => personalInfoCsvRow(r))], 'bj-personal-info');
    });

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setDone(null);
    setPlan(null);
    const text = await file.text();
    startTransition(async () => {
      const known = await getImportablePersonnelNos();
      if (!known.ok) {
        setError(known.error);
        return;
      }
      setPlan(validatePersonalInfoCsv(parseCsv(text), new Set(known.personnelNos)));
    });
  };

  const onApply = () =>
    startTransition(async () => {
      if (!plan) return;
      const res = await importPersonalInfo(plan.rows);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(res.updated);
      setPlan(null);
    });

  const fieldLabel = (field: PersonalInfoImportError['field']) =>
    field === null ? '' : field === 'personnel_no' ? t('personnelNo') : field === 'full_name' ? '' : tf(field);
  const problemLabel = (e: PersonalInfoImportError) =>
    e.problem === 'missingColumn' ||
    e.problem === 'personnelNo' ||
    e.problem === 'unknownEmployee' ||
    e.problem === 'duplicate' ||
    e.problem === 'empty'
      ? t(`problems.${e.problem}`)
      : tp(e.problem);

  return (
    <div className="space-y-4">
      <Link href={`/${locale}/manage/employees`} className="block text-sm text-primary hover:underline">
        {t('back')}
      </Link>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t('exportTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm text-muted-foreground">{t('exportHint')}</p>
          <Button type="button" onClick={onExport} disabled={isPending} data-testid="personal-info-export">
            {t('export')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>{t('importTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <p className="text-sm text-muted-foreground">{t('importHint')}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => download([personalInfoHeader()], 'bj-personal-info-template')}
          >
            {t('template')}
          </Button>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            disabled={isPending}
            data-testid="personal-info-import-file"
            className="block w-full text-sm file:me-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary file:px-4 file:py-2 file:text-primary-foreground"
          />

          {plan && (
            <div className="space-y-3" data-testid="personal-info-import-plan">
              <p className="text-sm">{t('ready', { count: plan.rows.length })}</p>
              {plan.errors.length > 0 && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="mb-2 text-sm font-medium text-destructive">
                    {t('errors', { count: plan.errors.length })}
                  </p>
                  <ul className="max-h-64 space-y-1 overflow-y-auto text-xs" data-testid="personal-info-import-errors">
                    {plan.errors.map((e, i) => (
                      <li key={i}>
                        {t('line', { line: e.line })} · {fieldLabel(e.field)}
                        {e.value ? <bdi dir="ltr"> «{e.value}»</bdi> : null}: {problemLabel(e)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button
                type="button"
                onClick={onApply}
                disabled={isPending || plan.rows.length === 0 || plan.errors.length > 0}
                data-testid="personal-info-import-apply"
              >
                {t('apply')}
              </Button>
              {plan.errors.length > 0 && <p className="text-xs text-muted-foreground">{t('fixFirst')}</p>}
            </div>
          )}

          {done !== null && (
            <p role="status" className="text-sm text-success" data-testid="personal-info-import-done">
              {t('done', { count: done })}
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
