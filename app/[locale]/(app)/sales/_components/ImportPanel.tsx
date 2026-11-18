'use client';

/**
 * FR-94 §6b: import the client's contract ledger. The .xlsx is read in the
 * browser (it is never uploaded or stored); only the parsed rows go to the
 * server, which checks each row again. A template with the exact headers is
 * generated here too.
 */

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { importSalesLedger, removeSalesBatch } from '@/lib/actions/sales';
import { inChargeNames, parseLedger, templateRows, type LedgerIssue, type LedgerRow } from '@/lib/sales/ledger';
import type { Bootstrap, ImportBatch, ImportResult, RecordNumbers } from '@/lib/sales/types';
import { tabClass, tabListClass } from '@/lib/ui/tabs';
import { InquiryImport } from './InquiryImport';
import { readXlsx, writeXlsx } from '@/lib/sales/xlsx';
import { ConfirmDialog, PersonPick, Tag, useRun, useSalesFormat } from './parts';

type Parsed = {
  fileName: string;
  rows: LedgerRow[];
  issues: LedgerIssue[];
  unknown: string[];
  missing: string[];
  names: string[];
};

const norm = (s: string) => s.replace(/[يك‌]/g, (c) => (c === 'ي' ? 'ی' : c === 'ك' ? 'ک' : '')).replace(/\s+/g, ' ').trim().toLowerCase();

function LedgerImport({ boot, existingNumbers }: { boot: Bootstrap; existingNumbers: Set<number> }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const input = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState<string[]>([]);
  const [people, setPeople] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  function downloadTemplate() {
    const bytes = writeXlsx('BJ Contract', templateRows());
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contract-ledger-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function choose(file: File | undefined) {
    setResult(null);
    setParsed(null);
    setError(null);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return setError(t('import.tooLarge'));
    let out: ReturnType<typeof parseLedger> | null = null;
    try {
      const sheets = readXlsx(new Uint8Array(await file.arrayBuffer()));
      // The ledger sheet is the first one that has the Rec header.
      for (const sheet of sheets) {
        const attempt = parseLedger(sheet.rows);
        if (attempt.ok) { out = attempt; break; }
      }
    } catch {
      return setError(t('import.notXlsx'));
    }
    if (!out || !out.ok) return setError(t('import.noHeader'));
    if (out.rows.length > 3000) return setError(t('import.tooManyRows', { max: 3000 }));
    const names = inChargeNames(out.rows);
    setParsed({ fileName: file.name, rows: out.rows, issues: out.issues, unknown: out.unknown, missing: out.missing, names });
    setKeep([]);
    // Pre-match each in-charge name to an employee with exactly that name.
    setPeople(Object.fromEntries(names.map((name) => [name, boot.people.find((p) => norm(p.name) === norm(name))?.id ?? null])));
  }

  function reset() {
    setParsed(null);
    setError(null);
    if (input.current) input.current.value = '';
  }

  async function doImport() {
    if (!parsed) return;
    const map = Object.fromEntries(Object.entries(people).filter((e): e is [string, string] => !!e[1]));
    await run(async () => {
      const out = await importSalesLedger(parsed.fileName, parsed.rows, keep, map);
      if (out.ok) setResult(out.data);
      return out;
    }, reset);
  }

  const existing = existingNumbers;
  const errors = parsed?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === 'warning') ?? [];
  const updates = parsed?.rows.filter((r) => existing.has(r.rec)).length ?? 0;

  return (
    <div className="flex flex-col gap-8" data-testid="sales-import">
      <section className="flex max-w-3xl flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('import.intro')}</p>
        <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t('import.step1')}</li>
          <li>{t('import.step2')}</li>
          <li>{t('import.step3')}</li>
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="max-sm:h-11" onClick={downloadTemplate} data-testid="sales-import-template">
            <Download aria-hidden="true" /> {t('import.template')}
          </Button>
          <Button className="max-sm:h-11" onClick={() => input.current?.click()} disabled={pending} data-testid="sales-import-choose">
            <Upload aria-hidden="true" /> {t('import.choose')}
          </Button>
          <input ref={input} type="file" accept=".xlsx" className="hidden" data-testid="sales-import-file"
            onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive" data-testid="sales-import-error">{error}</p> : null}
        {result ? (
          <div role="status" className="border-s-[3px] border-success ps-3 text-sm" data-testid="sales-import-result">
            <p className="font-semibold">{t('import.done', { created: result.created, updated: result.updated, skipped: result.skipped })}</p>
            {result.skipped_rows.length > 0 ? (
              <ul className="mt-1 text-muted-foreground">
                {result.skipped_rows.slice(0, 20).map((s, i) => <li key={i}><bdi dir="ltr">{String(s.rec ?? '—')}</bdi>: {t(`import.skip.${s.reason}`)}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      {parsed ? (
        <section className="flex flex-col gap-5 border-t border-border pt-5" data-testid="sales-import-preview">
          <div>
            <h3 className="text-sm font-semibold">{t('import.previewTitle', { file: parsed.fileName })}</h3>
            <dl className="mt-3 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="border-s-[3px] border-primary ps-3"><dt className="text-xs text-muted-foreground">{t('import.rows')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(parsed.rows.length)}</dd></div>
              <div className="border-s-[3px] border-primary ps-3"><dt className="text-xs text-muted-foreground">{t('import.willUpdate')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(updates)}</dd></div>
              <div className="border-s-[3px] border-destructive ps-3"><dt className="text-xs text-muted-foreground">{t('import.leftOut')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(errors.length)}</dd></div>
              <div className="border-s-[3px] border-warning ps-3"><dt className="text-xs text-muted-foreground">{t('import.emptied')}</dt><dd className="text-lg font-bold tabular-nums">{f.number(warnings.length)}</dd></div>
            </dl>
          </div>

          {parsed.missing.length > 0 ? (
            <p className="text-sm text-warning">{t('import.missing')}: <bdi dir="ltr">{parsed.missing.join(' · ')}</bdi></p>
          ) : null}

          {parsed.unknown.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold">{t('import.unknownTitle')}</legend>
              <p className="text-xs text-muted-foreground">{t('import.unknownHint')}</p>
              {parsed.unknown.map((header) => (
                <label key={header} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={keep.includes(header)}
                    onChange={(e) => setKeep(e.target.checked ? [...keep, header] : keep.filter((h) => h !== header))} />
                  <bdi>{header}</bdi>
                </label>
              ))}
            </fieldset>
          ) : null}

          {parsed.names.length > 0 ? (
            <div className="flex max-w-2xl flex-col gap-2">
              <h4 className="text-sm font-semibold">{t('import.peopleTitle')}</h4>
              <p className="text-xs text-muted-foreground">{t('import.peopleHint')}</p>
              <ul className="divide-y divide-border border-y border-border">
                {parsed.names.map((name) => (
                  <li key={name} className="grid items-center gap-2 py-2 sm:grid-cols-2">
                    <span className="text-sm"><bdi>{name}</bdi></span>
                    <PersonPick people={boot.people} value={people[name] ?? null} onChange={(id) => setPeople({ ...people, [name]: id })}
                      testId={`sales-import-person-${name}`} ariaLabel={name} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {parsed.issues.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">{t('import.issuesTitle')}</h4>
              <div className="max-h-80 overflow-auto border-b border-border">
                <table className="data-table w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-start">{t('import.row')}</th>
                      <th className="text-start">{t('import.column')}</th>
                      <th className="text-start">{t('import.value')}</th>
                      <th className="text-start">{t('import.problem')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {parsed.issues.map((issue, i) => (
                      <tr key={i} className="whitespace-nowrap">
                        <td className="tabular-nums">{f.number(issue.row)}</td>
                        <td><bdi dir="ltr">{issue.column}</bdi></td>
                        <td className="max-w-60 truncate"><bdi>{issue.value || '—'}</bdi></td>
                        <td><Tag tone={issue.level === 'error' ? 'bad' : 'warn'}>{t(`import.issue.${issue.code}`)}</Tag></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : <p className="text-sm text-success">{t('import.clean')}</p>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="max-sm:h-11" disabled={pending || parsed.rows.length === 0} onClick={() => void doImport()} data-testid="sales-import-confirm">
              {t('import.confirm', { count: parsed.rows.length })}
            </Button>
            <Button variant="outline" className="max-sm:h-11" disabled={pending} onClick={reset}>{t('cancel')}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BatchList({ boot }: { boot: Bootstrap }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [removing, setRemoving] = useState<ImportBatch | null>(null);
  const [removed, setRemoved] = useState<{ deleted: number; kept: number } | null>(null);
  return (
    <>
      <section className="flex flex-col gap-3 border-t border-border pt-5">
        <h3 className="text-sm font-semibold">{t('import.batchesTitle')}</h3>
        <p className="max-w-3xl text-xs text-muted-foreground">{t('import.batchesHint')}</p>
        {removed ? <p role="status" className="text-sm text-success">{t('import.removed', removed)}</p> : null}
        {boot.batches.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t('import.noBatches')}</p> : (
          <div className="max-w-4xl overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-start">{t('import.when')}</th>
                  <th className="text-start">{t('import.file')}</th>
                  <th className="text-start">{t('import.kind')}</th>
                  <th className="text-end tabular-nums">{t('import.created')}</th>
                  <th className="text-end tabular-nums">{t('import.updated')}</th>
                  <th className="text-end tabular-nums">{t('import.skipped')}</th>
                  <th className="text-end tabular-nums">{t('import.untouched')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {boot.batches.map((b) => (
                  <tr key={b.id} className="whitespace-nowrap">
                    <td>{f.date(b.created_at)}</td>
                    <td className="max-w-60 truncate"><bdi dir="ltr">{b.file_name ?? '—'}</bdi></td>
                    <td>
                      {t(b.kind === 'inquiry' ? 'import.kindInquiry' : 'import.kindLedger')}
                      {!b.closed ? <> <Tag tone="warn">{t('import.incomplete')}</Tag></> : null}
                    </td>
                    <td className="text-end tabular-nums">{f.number(b.created_count)}</td>
                    <td className="text-end tabular-nums">{f.number(b.updated_count)}</td>
                    <td className="text-end tabular-nums">{f.number(b.skipped_count)}</td>
                    <td className="text-end tabular-nums">{f.number(b.untouched)} / {f.number(b.records)}</td>
                    <td className="whitespace-nowrap text-end">
                      <Link href={`/${f.locale}/sales/settings/names?batch=${b.id}`} className="inline-flex h-7 items-center px-2 text-xs text-primary hover:underline" data-testid="sales-import-fix-names">{t('names.fixNames')}</Link>
                      {b.untouched > 0 ? (
                        <Button size="xs" variant="ghost" className="text-destructive" onClick={() => { setRemoved(null); setRemoving(b); }} data-testid="sales-import-remove">{t('import.remove')}</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {removing ? (
        <ConfirmDialog
          title={t('import.removeTitle')}
          body={t('import.removeBody', { count: removing.untouched, kept: removing.records - removing.untouched })}
          confirmLabel={t('import.removeConfirm', { count: removing.untouched })} cancelLabel={t('cancel')} pending={pending}
          onClose={() => setRemoving(null)}
          onConfirm={() => void run(async () => {
            const out = await removeSalesBatch(removing.id);
            if (out.ok) setRemoved(out.data);
            return out;
          }, () => setRemoving(null))}
        />
      ) : null}
    </>
  );
}

export function ImportPanel({ boot, numbers }: { boot: Bootstrap; numbers: RecordNumbers }) {
  const t = useTranslations('sales');
  const locale = useLocale();
  const [tab, setTab] = useState<'ledger' | 'inquiry'>('ledger');
  const existing = useMemo(() => new Set([...numbers.app, ...numbers.ledger, ...numbers.inquiry]), [numbers]);
  return (
    <div className="flex flex-col gap-6" data-testid="sales-import-panel">
      <div role="tablist" aria-label={t('import.kind')} className={tabListClass}>
        {(['ledger', 'inquiry'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tabClass(tab === k)}
            onClick={() => setTab(k)} data-testid={`sales-import-tab-${k}`}>
            {t(k === 'ledger' ? 'import.kindLedger' : 'import.kindInquiry')}
          </button>
        ))}
      </div>
      {tab === 'ledger' ? <LedgerImport boot={boot} existingNumbers={existing} /> : <InquiryImport boot={boot} numbers={numbers} />}
      <p className="text-sm">
        <Link href={`/${locale}/sales/settings/names`} className="text-primary underline underline-offset-2" data-testid="sales-import-names">{t('names.title')}</Link>
      </p>
      <BatchList boot={boot} />
    </div>
  );
}
