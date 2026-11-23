'use client';

/**
 * FR-94 §16: import the client's inquiry register (.csv or .xlsx). The file is read
 * in the browser and never uploaded as a file; the rows go to the server in parts of
 * 1000 under one batch. The preview shows what each row becomes, which spellings of a
 * company look the same, and who each in-charge name is.
 */

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { importSalesInquiries } from '@/lib/actions/sales';
import { parseCsv } from '@/lib/csv/parse';
import { todayInAppTz } from '@/lib/appDate';
import {
  classifyInquiry, inChargeNames, INQUIRY_HEADERS, parseInquiryRegister, similarCustomerGroups,
  type CustomerGroup, type InquiryClass, type InquiryIssue, type InquiryRow,
} from '@/lib/sales/inquiry';
import type { Bootstrap, InquiryImportResult, InquiryResultKey, RecordNumbers } from '@/lib/sales/types';
import { readXlsx, writeXlsx } from '@/lib/sales/xlsx';
import { DateInput, PersonPick, Select, Tag, useSalesFormat } from './parts';

const CHUNK = 1000;
const MAX_ROWS = 60000;
const PEOPLE_SHOWN = 30;
const ISSUES_SHOWN = 200;
const RESULT_KEYS: InquiryResultKey[] = ['won', 'lost', 'no_bid', 'cancelled', 'open', 'archived'];

type Parsed = {
  fileName: string;
  rows: InquiryRow[];
  issues: InquiryIssue[];
  missing: string[];
  separators: number;
};
type Choice = { same: boolean; name: string };

const norm = (s: string) => s.replace(/[يك‌]/g, (c) => (c === 'ي' ? 'ی' : c === 'ك' ? 'ک' : '')).replace(/\s+/g, ' ').trim().toLowerCase();
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Today minus six months, as ISO, by plain date arithmetic (day clamped to the month's end). */
function sixMonthsBack(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 - 6, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

const CLASS_TO_RESULT: Partial<Record<InquiryClass, InquiryResultKey>> = {
  won_new: 'won', won_finish: 'won', lost: 'lost', no_bid: 'no_bid', cancelled: 'cancelled', open: 'open', archived: 'archived',
};

export function InquiryImport({ boot, numbers }: { boot: Bootstrap; numbers: RecordNumbers }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState<string>(() => sixMonthsBack(todayInAppTz()));
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [people, setPeople] = useState<Record<string, string | null>>({});
  const [allPeople, setAllPeople] = useState(false);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ data: InquiryImportResult; stopped: boolean } | null>(null);

  const sets = useMemo(() => ({ app: new Set(numbers.app), ledger: new Set(numbers.ledger), inquiry: new Set(numbers.inquiry) }), [numbers]);

  const names = useMemo(() => (parsed ? inChargeNames(parsed.rows) : []), [parsed]);
  const groups = useMemo<CustomerGroup[]>(() => {
    if (!parsed) return [];
    const counts = new Map<string, number>();
    for (const r of parsed.rows) if (r.buyer) counts.set(collapse(r.buyer), (counts.get(collapse(r.buyer)) ?? 0) + 1);
    return similarCustomerGroups([...counts].map(([name, count]) => ({ name, count })), boot.customers.map((c) => c.name));
  }, [parsed, boot.customers]);
  const decide = groups.filter((g) => g.probable || g.existing !== null);
  const merged = groups.filter((g) => !(g.probable || g.existing !== null));

  const stats = useMemo(() => {
    const out = { fresh: 0, update: 0, fill: 0, app: 0, loser: 0, by: Object.fromEntries(RESULT_KEYS.map((k) => [k, 0])) as Record<InquiryResultKey, number> };
    if (!parsed) return out;
    for (const r of parsed.rows) {
      const origin = sets.app.has(r.rec) ? 'app' : sets.ledger.has(r.rec) ? 'ledger' : sets.inquiry.has(r.rec) ? 'inquiry' : null;
      const cls = classifyInquiry(r, origin, cutoff);
      if (cls === 'skip_app') out.app += 1;
      else if (cls === 'fill_only') { out.fill += 1; if (r.lost_price !== null) out.loser += 1; }
      else {
        if (origin === 'inquiry') out.update += 1; else out.fresh += 1;
        const key = CLASS_TO_RESULT[cls];
        if (key) out.by[key] += 1;
      }
    }
    return out;
  }, [parsed, sets, cutoff]);

  const errors = parsed?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = parsed?.issues.filter((i) => i.level === 'warning') ?? [];

  function downloadTemplate() {
    const bytes = writeXlsx('Inquiry', [INQUIRY_HEADERS]);
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = t('import.inquiry.templateName');
    a.click();
    URL.revokeObjectURL(url);
  }

  async function choose(file: File | undefined) {
    setResult(null);
    setParsed(null);
    setError(null);
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return setError(t('import.tooLarge'));
    let out: ReturnType<typeof parseInquiryRegister> | null = null;
    try {
      if (/\.csv$/i.test(file.name)) {
        out = parseInquiryRegister(parseCsv(new TextDecoder('utf-8').decode(await file.arrayBuffer())));
      } else {
        for (const sheet of readXlsx(new Uint8Array(await file.arrayBuffer()))) {
          const attempt = parseInquiryRegister(sheet.rows);
          if (attempt.ok) { out = attempt; break; }
        }
      }
    } catch {
      return setError(t('import.inquiry.notReadable'));
    }
    if (!out || !out.ok) return setError(t('import.inquiry.noHeader'));
    if (out.rows.length > MAX_ROWS) return setError(t('import.tooManyRows', { max: MAX_ROWS }));
    const next: Parsed = { fileName: file.name, rows: out.rows, issues: out.issues, missing: out.missing, separators: out.separators };
    setParsed(next);
    const found = inChargeNames(out.rows);
    setPeople(Object.fromEntries(found.map(({ name }) => [name, boot.people.find((p) => norm(p.name) === norm(name))?.id ?? null])));
    setAllPeople(false);
    setChoices({});
  }

  function reset() {
    setParsed(null);
    setError(null);
    setChoices({});
    if (input.current) input.current.value = '';
  }

  const choiceOf = (g: CustomerGroup): Choice => choices[g.key] ?? { same: true, name: g.suggested };

  async function doImport() {
    if (!parsed) return;
    const rename = new Map<string, string>();
    for (const g of decide) {
      const c = choiceOf(g);
      if (c.same) for (const s of g.spellings) rename.set(s.name, c.name);
    }
    const rows = parsed.rows.map((r) => (r.buyer && rename.has(collapse(r.buyer)) ? { ...r, buyer: rename.get(collapse(r.buyer))! } : r));
    const map = Object.fromEntries(Object.entries(people).filter((e): e is [string, string] => !!e[1]));
    stopRef.current = false;
    setResult(null);
    setSending({ done: 0, total: rows.length });
    const total: InquiryImportResult = { batch_id: '', created: 0, updated: 0, skipped: 0, deleted: 0, skipped_rows: [], by_result: { won: 0, lost: 0, no_bid: 0, cancelled: 0, open: 0, archived: 0 } };
    let batchId: string | null = null;
    let done = 0;
    let stopped = false;
    try {
      for (let at = 0; at < rows.length || at === 0; at += CHUNK) {
        const last = at + CHUNK >= rows.length;
        const out = await importSalesInquiries(batchId, parsed.fileName, rows.slice(at, at + CHUNK), map, cutoff, last);
        if (!out.ok) { toast.error(out.error); stopped = !last; break; }
        batchId = out.data.batch_id;
        total.batch_id = batchId;
        total.created += out.data.created;
        total.updated += out.data.updated;
        total.skipped += out.data.skipped;
        total.deleted = (total.deleted ?? 0) + (out.data.deleted ?? 0);
        total.skipped_rows.push(...out.data.skipped_rows);
        for (const k of RESULT_KEYS) total.by_result[k] += out.data.by_result?.[k] ?? 0;
        done = Math.min(at + CHUNK, rows.length);
        setSending({ done, total: rows.length });
        if (last) break;
        if (stopRef.current) { stopped = true; break; }
      }
    } finally {
      setSending(null);
    }
    setResult({ data: total, stopped });
    reset();
    router.refresh();
  }

  const shownPeople = allPeople ? names : names.slice(0, PEOPLE_SHOWN);
  const pct = sending && sending.total > 0 ? Math.round((sending.done / sending.total) * 100) : 0;
  const stat = (label: string, value: number, tone: string) => (
    <div key={label} className={`border-s-[3px] ps-3 ${tone}`}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-bold tabular-nums">{f.number(value)}</dd></div>
  );

  return (
    <div className="flex flex-col gap-8" data-testid="sales-inquiry-import">
      <section className="flex max-w-3xl flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('import.inquiry.intro')}</p>
        <ol className="list-decimal space-y-1 ps-5 text-sm text-muted-foreground">
          <li>{t('import.inquiry.step1')}</li>
          <li>{t('import.inquiry.step2')}</li>
          <li>{t('import.inquiry.step3')}</li>
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="max-sm:h-11" onClick={downloadTemplate} data-testid="sales-inquiry-template">
            <Download aria-hidden="true" /> {t('import.template')}
          </Button>
          <Button className="max-sm:h-11" onClick={() => input.current?.click()} disabled={!!sending} data-testid="sales-inquiry-choose">
            <Upload aria-hidden="true" /> {t('import.inquiry.choose')}
          </Button>
          <input ref={input} type="file" accept=".csv,.xlsx" className="hidden" data-testid="sales-inquiry-file"
            onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive" data-testid="sales-inquiry-error">{error}</p> : null}
        {result ? (
          <div role="status" className="border-s-[3px] border-success ps-3 text-sm" data-testid="sales-inquiry-result">
            <p className="font-semibold">
              {t('import.inquiry.done', { created: result.data.created, updated: result.data.updated, skipped: result.data.skipped, ...result.data.by_result })}
            </p>
            {result.data.deleted ? <p className="mt-1 text-muted-foreground" data-testid="sales-inquiry-deleted">{t('import.deletedNote', { count: result.data.deleted })}</p> : null}
            {result.stopped ? <p className="mt-1 text-warning">{t('import.inquiry.stopped')}</p> : null}
            {result.data.skipped_rows.length > 0 ? (
              <ul className="mt-1 text-muted-foreground">
                {result.data.skipped_rows.slice(0, 20).map((s, i) => <li key={i}><bdi dir="ltr">{String(s.rec ?? '—')}</bdi>: {t(`import.skip.${s.reason}`)}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      {sending ? (
        <section className="flex max-w-xl flex-col gap-2" data-testid="sales-inquiry-progress">
          <p className="text-sm">{t('import.inquiry.progress', { done: f.number(sending.done), total: f.number(sending.total) })}</p>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={sending.total} aria-valuenow={sending.done}
            aria-label={t('import.inquiry.progress', { done: sending.done, total: sending.total })} className="h-2 w-full bg-secondary">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div>
            <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => { stopRef.current = true; }} data-testid="sales-inquiry-stop">
              {t('import.inquiry.stop')}
            </Button>
          </div>
        </section>
      ) : null}

      {parsed && !sending ? (
        <section className="flex flex-col gap-5 border-t border-border pt-5" data-testid="sales-inquiry-preview">
          <div className="flex flex-col gap-4">
            <h3 className="text-sm font-semibold">{t('import.previewTitle', { file: parsed.fileName })}</h3>
            <dl className="grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
              {stat(t('import.rows'), parsed.rows.length, 'border-primary')}
              {stat(t('import.inquiry.newRecords'), stats.fresh, 'border-primary')}
              {stat(t('import.inquiry.updateInquiry'), stats.update, 'border-primary')}
              {stat(t('import.inquiry.fillLedger'), stats.fill, 'border-primary')}
              {stat(t('import.inquiry.skipApp'), stats.app, 'border-primary')}
              {stat(t('import.leftOut'), errors.length, 'border-destructive')}
              {stat(t('import.emptied'), warnings.length, 'border-warning')}
            </dl>
            {parsed.separators > 0 ? <p className="text-xs text-muted-foreground">{t('import.inquiry.separators', { count: parsed.separators })}</p> : null}
          </div>

          {parsed.missing.length > 0 ? (
            <p className="text-sm text-warning">{t('import.missing')}: <bdi dir="ltr">{parsed.missing.join(' · ')}</bdi></p>
          ) : null}

          <div className="flex max-w-4xl flex-col gap-3">
            <h4 className="text-sm font-semibold">{t('import.inquiry.resultsTitle')}</h4>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {RESULT_KEYS.map((k) => stat(t(`import.inquiry.result.${k}`), stats.by[k], 'border-border'))}
            </dl>
            <div className="flex max-w-sm flex-col gap-1">
              <label className="text-sm font-medium" htmlFor="sales-inquiry-cutoff">{t('import.inquiry.cutoff')}</label>
              <div id="sales-inquiry-cutoff"><DateInput value={cutoff} onChange={(iso) => iso && setCutoff(iso)} testId="sales-inquiry-cutoff" /></div>
              <p className="text-xs text-muted-foreground">{t('import.inquiry.cutoffHint')}</p>
            </div>
            {stats.loser > 0 ? <p className="border-s-[3px] border-warning ps-3 text-sm" data-testid="sales-inquiry-loser">{t('import.inquiry.loserNote', { count: stats.loser })}</p> : null}
          </div>

          {decide.length > 0 || merged.length > 0 ? (
            <div className="flex max-w-3xl flex-col gap-2">
              <h4 className="text-sm font-semibold">{t('import.inquiry.similarTitle')}</h4>
              <p className="text-xs text-muted-foreground">{t('import.inquiry.similarHint')}</p>
              {merged.length > 0 ? <p className="text-sm text-muted-foreground">{t('import.inquiry.merged', { count: merged.reduce((n, g) => n + g.spellings.length, 0) })}</p> : null}
              <ul className="divide-y divide-border border-y border-border">
                {decide.map((g) => {
                  const c = choiceOf(g);
                  const options = [...(g.existing ? [g.existing] : []), ...g.spellings.map((s) => s.name).filter((n) => n !== g.existing)];
                  return (
                    <li key={g.key} className="flex flex-col gap-2 py-3" data-testid="sales-inquiry-group">
                      <p className="flex flex-wrap items-center gap-2 text-sm">
                        <Tag tone={g.probable ? 'warn' : 'neutral'}>{g.probable ? t('import.inquiry.probable') : t('import.inquiry.certain')}</Tag>
                        {g.spellings.map((s) => <span key={s.name}><bdi>{s.name}</bdi> <span className="text-xs text-muted-foreground tabular-nums">({f.number(s.count)})</span></span>)}
                        {g.existing ? <span className="text-xs text-muted-foreground">· <bdi>{g.existing}</bdi> {t('import.inquiry.existing')}</span> : null}
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="radio" className="size-4" name={`grp-${g.key}`} checked={c.same}
                            onChange={() => setChoices({ ...choices, [g.key]: { ...c, same: true } })} />
                          {t('import.inquiry.sameCompany')}
                        </label>
                        <div className="flex items-center gap-2 sm:min-w-64">
                          <span className="text-sm text-muted-foreground">{t('import.inquiry.useName')}</span>
                          <Select value={c.name} ariaLabel={t('import.inquiry.useName')} disabled={!c.same} className="min-w-0 flex-1"
                            onChange={(name) => setChoices({ ...choices, [g.key]: { same: true, name } })}>
                            {options.map((n) => <option key={n} value={n}>{n}</option>)}
                          </Select>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="radio" className="size-4" name={`grp-${g.key}`} checked={!c.same}
                            onChange={() => setChoices({ ...choices, [g.key]: { ...c, same: false } })} />
                          {t('import.inquiry.different')}
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {names.length > 0 ? (
            <div className="flex max-w-2xl flex-col gap-2">
              <h4 className="text-sm font-semibold">{t('import.peopleTitle')}</h4>
              <p className="text-xs text-muted-foreground">{t('import.inquiry.peopleHint')}</p>
              <ul className="divide-y divide-border border-y border-border">
                {shownPeople.map(({ name, count }) => (
                  <li key={name} className="grid items-center gap-2 py-2 sm:grid-cols-2">
                    <span className="text-sm"><bdi>{name}</bdi> <span className="text-xs text-muted-foreground tabular-nums">({f.number(count)})</span></span>
                    <PersonPick people={boot.people} value={people[name] ?? null} onChange={(id) => setPeople({ ...people, [name]: id })}
                      testId={`sales-inquiry-person-${name}`} ariaLabel={name} />
                  </li>
                ))}
              </ul>
              {!allPeople && names.length > PEOPLE_SHOWN ? (
                <div><Button variant="ghost" size="sm" onClick={() => setAllPeople(true)}>{t('import.inquiry.showAll', { count: names.length })}</Button></div>
              ) : null}
            </div>
          ) : null}

          {parsed.issues.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h4 className="text-sm font-semibold">{t('import.issuesTitle')} <span className="font-normal tabular-nums text-muted-foreground">({f.number(parsed.issues.length)})</span></h4>
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
                    {parsed.issues.slice(0, ISSUES_SHOWN).map((issue, i) => (
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
            <Button className="max-sm:h-11" disabled={parsed.rows.length === 0} onClick={() => void doImport()} data-testid="sales-inquiry-confirm">
              {t('import.confirm', { count: parsed.rows.length })}
            </Button>
            <Button variant="outline" className="max-sm:h-11" onClick={reset}>{t('cancel')}</Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
