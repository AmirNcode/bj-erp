'use client';

/**
 * FR-98 §9: bulk customer import (.xlsx). The file is read in the browser (no upload); the rows go to
 * the server twice: a preview (nothing saved), then the import with the user's decisions
 * (unknown categories / cities, what to do with customers already registered).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  getCustomerLists, importCustomers, listCustomerImportBatches, previewCustomerImport, removeCustomerImportBatch,
} from '@/lib/actions/sales';
import { customerLabel } from '@/lib/sales/customerLabel';
import {
  CUSTOMER_IMPORT_COLUMNS, parseCustomerSheet, templateRows, type CustomerImportColumn,
} from '@/lib/sales/customerImport';
import type {
  CustomerImportBatch, CustomerImportCells, CustomerImportPreview, CustomerLists, CustomerRef, ImportAction,
  ImportListDecision,
} from '@/lib/sales/types';
import { readXlsx, writeXlsx } from '@/lib/sales/xlsx';
import { useViewAs } from '../../_components/ViewAsContext';
import { ConfirmDialog, ModalContent, Select, useSalesFormat } from './parts';

type Choice = 'create' | 'use' | 'empty';
type Step = 'unknown' | 'matches' | 'summary';
type Headers = Record<CustomerImportColumn, string>;

const EXAMPLE: Record<'fa' | 'en', Headers> = {
  fa: {
    name: 'شرکت نمونه', name_en: 'NISOC', kind: 'پیمانکار', ceo_name: 'علی رضایی', province: 'خوزستان', city: 'اهواز',
    address: 'کیانپارس، خیابان نمونه', rank: '1', category: 'نفت و گاز', contact_person: 'محمد احمدی', contact_title: 'مدیر خرید',
    contact_label: 'موبایل', phone: '09121234567', email: 'info@example.com',
  },
  en: {
    name: 'شرکت نمونه', name_en: 'NISOC', kind: 'Contractor', ceo_name: 'Ali Rezaei', province: 'Khuzestan', city: 'Ahvaz',
    address: 'Kianpars, Sample St.', rank: '1', category: 'Oil and gas', contact_person: 'Mohammad Ahmadi', contact_title: 'Purchasing manager',
    contact_label: 'Mobile', phone: '09121234567', email: 'info@example.com',
  },
};

export function CustomerImport({ customers }: { customers: CustomerRef[] }) {
  const t = useTranslations('sales.customerImport');
  const locale = useLocale();
  const f = useSalesFormat();
  const router = useRouter();
  const viewAs = useViewAs();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<CustomerImportCells[]>([]);
  const [preview, setPreview] = useState<CustomerImportPreview | null>(null);
  const [lists, setLists] = useState<CustomerLists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [cat, setCat] = useState<Record<string, Choice>>({});
  const [catUse, setCatUse] = useState<Record<string, string>>({});
  const [city, setCity] = useState<Record<string, Choice>>({});
  const [cityUse, setCityUse] = useState<Record<string, string>>({});
  const [defaultAction, setDefaultAction] = useState<ImportAction>('skip');
  const [actions, setActions] = useState<Record<string, ImportAction | ''>>({});
  const [pending, setPending] = useState(false);
  const [batches, setBatches] = useState<CustomerImportBatch[]>([]);
  const [removing, setRemoving] = useState<CustomerImportBatch | null>(null);
  const [removePending, setRemovePending] = useState(false);

  const loadBatches = useCallback(async () => {
    const r = await listCustomerImportBatches();
    if (r.ok) setBatches(r.data);
  }, []);

  useEffect(() => {
    if (!open) return;
    void listCustomerImportBatches().then((r) => { if (r.ok) setBatches(r.data); });
    void getCustomerLists().then((r) => { if (r.ok) setLists(r.data); });
  }, [open]);

  const steps = useMemo<Step[]>(() => {
    if (!preview) return [];
    const out: Step[] = [];
    if (preview.unknown.categories.length + preview.unknown.cities.length > 0) out.push('unknown');
    if (preview.counts.match > 0) out.push('matches');
    out.push('summary');
    return out;
  }, [preview]);
  const step = steps[stepIdx];

  const fileRows = useMemo(() => new Map(rows.map((r) => [r.row, r])), [rows]);
  const label = (c: { name: string | null; name_en?: string | null }) => customerLabel(c, locale);
  const provinceName = (code: string) => {
    const p = lists?.provinces.find((x) => x.code === code);
    return p ? (locale === 'fa' ? p.name_fa : p.name_en) : code;
  };
  const activeCategories = lists?.categories.filter((c) => c.active) ?? [];
  const citiesOf = (province: string) => lists?.cities.filter((c) => c.active && c.province_code === province) ?? [];

  if (viewAs !== null) return null;

  function reset() {
    setFileName(''); setRows([]); setPreview(null); setError(null); setStepIdx(0);
    setCat({}); setCatUse({}); setCity({}); setCityUse({}); setDefaultAction('skip'); setActions({});
    if (input.current) input.current.value = '';
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function downloadTemplate() {
    const lang = locale === 'fa' ? 'fa' : 'en';
    const headers = Object.fromEntries(CUSTOMER_IMPORT_COLUMNS.map((c) => [c, t(`headers.${c}`)])) as Headers;
    const bytes = writeXlsx('Customers', templateRows(headers, EXAMPLE[lang]));
    const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = t('templateFile');
    a.click();
    URL.revokeObjectURL(url);
  }

  async function headersOf(lang: string): Promise<Headers> {
    if (lang === locale) return Object.fromEntries(CUSTOMER_IMPORT_COLUMNS.map((c) => [c, t(`headers.${c}`)])) as Headers;
    const mod = (await import(`@/messages/${lang}.json`)) as { default: { sales: { customerImport: { headers: Headers } } } };
    return mod.default.sales.customerImport.headers;
  }

  async function choose(file: File | undefined) {
    reset();
    if (!file) return;
    setReading(true);
    try {
      let sheetRows;
      try {
        const sheets = readXlsx(new Uint8Array(await file.arrayBuffer()));
        sheetRows = sheets[0]?.rows;
      } catch {
        sheetRows = undefined;
      }
      if (!sheetRows) return setError(t('badFile'));
      const parsed = parseCustomerSheet(sheetRows, await headersOf('fa'), await headersOf('en'));
      if ('error' in parsed) return setError(t(parsed.error));
      const res = await previewCustomerImport(parsed.rows);
      if (!res.ok) return setError(res.error);
      setFileName(file.name);
      setRows(parsed.rows);
      setPreview(res.data);
      setStepIdx(0);
    } finally {
      setReading(false);
    }
  }

  const decisionsReady = (preview?.unknown.categories ?? []).every((u) => (cat[u.key] ?? 'create') !== 'use' || catUse[u.key])
    && (preview?.unknown.cities ?? []).every((u) => {
      const k = `${u.province_code}|${u.key}`;
      return (city[k] ?? 'create') !== 'use' || cityUse[k];
    });

  async function doImport() {
    if (!preview) return;
    const decide = (choice: Choice | undefined, id: string | undefined): ImportListDecision => {
      const c = choice ?? 'create';
      return c === 'use' && id ? { action: 'use', id } : c === 'empty' ? { action: 'empty' } : { action: 'create' };
    };
    const categories: Record<string, ImportListDecision> = {};
    for (const u of preview.unknown.categories) categories[u.key] = decide(cat[u.key], catUse[u.key]);
    const cities: Record<string, ImportListDecision> = {};
    for (const u of preview.unknown.cities) {
      const k = `${u.province_code}|${u.key}`;
      cities[k] = decide(city[k], cityUse[k]);
    }
    const overrides: Record<string, ImportAction> = {};
    for (const [row, a] of Object.entries(actions)) if (a) overrides[row] = a;
    setPending(true);
    try {
      const res = await importCustomers({ file_name: fileName, rows, default_action: defaultAction, actions: overrides, categories, cities });
      if (!res.ok) return void toast.error(res.error);
      toast.success(t('done', { created: res.data.created, updated: res.data.updated, skipped: res.data.skipped }));
      close();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function doRemove() {
    if (!removing) return;
    setRemovePending(true);
    try {
      const res = await removeCustomerImportBatch(removing.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(t('removed', { removed: res.data.removed, kept: res.data.kept }));
      setRemoving(null);
      await loadBatches();
      router.refresh();
    } finally {
      setRemovePending(false);
    }
  }

  const matchRows = preview?.rows.filter((r) => r.status === 'match') ?? [];
  const errorRows = preview?.rows.filter((r) => r.status === 'error') ?? [];
  const incomplete = preview?.rows.filter((r) => r.status !== 'error' && r.incomplete).length ?? 0;
  const dropped = preview?.rows.flatMap((r) => r.dropped.map((d) => ({ row: r.row, ...d }))) ?? [];
  const fieldName = (field: string) => (field in { name: 1, name_en: 1, kind: 1, ceo_name: 1, province: 1, city: 1, address: 1, rank: 1, category: 1, contact_person: 1, contact_title: 1, contact_label: 1, phone: 1, email: 1 } ? t(`headers.${field as CustomerImportColumn}`) : field === 'contact' ? t('headers.contact_person') : field);
  const errorText = (e: string | null) => (e === 'no_name' ? t('errorNoName') : e === 'duplicate_in_file' ? t('errorDuplicateInFile') : t('errorInvalid'));
  const stepLabel = (s: Step) => (s === 'unknown' ? t('stepUnknown') : s === 'matches' ? t('stepMatches') : t('stepSummary'));

  return (
    <>
      <Button variant="outline" className="max-sm:h-11" onClick={() => setOpen(true)} data-testid="sales-customer-import-open">
        <Upload className="size-4" aria-hidden />
        {t('button')}
      </Button>
      {open ? (
        <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
          <ModalContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{t('title')}</DialogTitle>
              <DialogDescription>{t('intro')}</DialogDescription>
            </DialogHeader>

            {!preview ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" onClick={downloadTemplate} data-testid="sales-customer-import-template">
                    <Download className="size-4" aria-hidden />
                    {t('template')}
                  </Button>
                  <input
                    ref={input}
                    type="file"
                    accept=".xlsx"
                    aria-label={t('pickFile')}
                    className="text-sm"
                    data-testid="sales-customer-import-file"
                    onChange={(e) => void choose(e.target.files?.[0])}
                  />
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">{t('acceptedTitle')}</p>
                  <p>{t('acceptedKind')}</p>
                  <p>{t('acceptedLabel')}</p>
                  <p>{t('acceptedRank')}</p>
                </div>
                {reading ? <p className="text-sm text-muted-foreground">{t('reading')}</p> : null}
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              </div>
            ) : (
              <div className="space-y-4">
                <ol className="flex flex-wrap gap-x-4 border-b text-sm">
                  {steps.map((s, i) => (
                    <li key={s} className={i === stepIdx ? 'border-b-2 border-primary pb-1.5 font-medium' : 'pb-1.5 text-muted-foreground'}>
                      {i + 1}. {stepLabel(s)}
                    </li>
                  ))}
                </ol>

                {step === 'unknown' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{t('unknownIntro')}</p>
                    {preview.unknown.categories.map((u) => (
                      <div key={`c${u.key}`} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1">{t('unknownCategory', { value: u.value, rows: u.rows })}</span>
                        <Select value={cat[u.key] ?? 'create'} onChange={(v) => setCat((s) => ({ ...s, [u.key]: v as Choice }))} ariaLabel={u.value} className="w-48">
                          <option value="create">{t('decideCreate')}</option>
                          <option value="use">{t('decideUse')}</option>
                          <option value="empty">{t('decideEmpty')}</option>
                        </Select>
                        {(cat[u.key] ?? 'create') === 'use' ? (
                          <Select value={catUse[u.key] ?? ''} onChange={(v) => setCatUse((s) => ({ ...s, [u.key]: v }))} ariaLabel={u.value} className="w-48">
                            <option value="" />
                            {activeCategories.map((c) => <option key={c.id} value={c.id}>{locale === 'fa' ? c.name_fa : c.name_en || c.name_fa}</option>)}
                          </Select>
                        ) : null}
                      </div>
                    ))}
                    {preview.unknown.cities.map((u) => {
                      const k = `${u.province_code}|${u.key}`;
                      return (
                        <div key={`t${k}`} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1">{t('unknownCity', { value: u.value, province: provinceName(u.province_code), rows: u.rows })}</span>
                          <Select value={city[k] ?? 'create'} onChange={(v) => setCity((s) => ({ ...s, [k]: v as Choice }))} ariaLabel={u.value} className="w-48">
                            <option value="create">{t('decideCreate')}</option>
                            <option value="use">{t('decideUse')}</option>
                            <option value="empty">{t('decideEmpty')}</option>
                          </Select>
                          {(city[k] ?? 'create') === 'use' ? (
                            <Select value={cityUse[k] ?? ''} onChange={(v) => setCityUse((s) => ({ ...s, [k]: v }))} ariaLabel={u.value} className="w-48">
                              <option value="" />
                              {citiesOf(u.province_code).map((c) => <option key={c.id} value={c.id}>{locale === 'fa' ? c.name_fa : c.name_en || c.name_fa}</option>)}
                            </Select>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {step === 'matches' ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">{t('matchesIntro', { count: matchRows.length })}</p>
                    <label className="flex flex-wrap items-center gap-2 text-sm">
                      <span>{t('defaultAction')}</span>
                      <Select value={defaultAction} onChange={(v) => setDefaultAction(v as ImportAction)} className="w-64" testId="sales-customer-import-default-action">
                        <option value="skip">{t('actionSkip')}</option>
                        <option value="update">{t('actionUpdate')}</option>
                        <option value="overwrite">{t('actionOverwrite')}</option>
                      </Select>
                    </label>
                    <div className="overflow-x-auto">
                      <table className="data-table w-full text-sm">
                        <thead>
                          <tr>
                            <th className="text-start">{t('rowCol')}</th>
                            <th className="text-start">{t('fileName')}</th>
                            <th className="text-start">{t('existing')}</th>
                            <th className="text-start">{t('action')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matchRows.map((r) => (
                            <tr key={r.row}>
                              <td>{f.number(r.row)}</td>
                              <td>{fileRows.get(r.row)?.name ?? ''}</td>
                              <td>{r.match ? label(customers.find((c) => c.id === r.match?.id) ?? r.match) : ''}</td>
                              <td>
                                <Select value={actions[String(r.row)] ?? ''} onChange={(v) => setActions((s) => ({ ...s, [String(r.row)]: v as ImportAction | '' }))} ariaLabel={t('action')} className="w-56">
                                  <option value="">—</option>
                                  <option value="skip">{t('actionSkip')}</option>
                                  <option value="update">{t('actionUpdate')}</option>
                                  <option value="overwrite">{t('actionOverwrite')}</option>
                                </Select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}

                {step === 'summary' ? (
                  <div className="space-y-3 text-sm">
                    <ul className="space-y-1">
                      <li>{t('summaryNew', { count: preview.counts.new })}</li>
                      <li>{t('summaryMatch', { count: preview.counts.match })}</li>
                      <li>{t('summaryError', { count: preview.counts.error })}</li>
                      <li>{t('summaryIncomplete', { count: incomplete })}</li>
                    </ul>
                    {errorRows.length > 0 ? (
                      <table className="data-table w-full">
                        <tbody>
                          {errorRows.map((r) => (
                            <tr key={r.row}><td>{f.number(r.row)}</td><td>{errorText(r.error)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    ) : null}
                    {dropped.length > 0 ? (
                      <div className="space-y-1">
                        <p className="font-medium">{t('droppedTitle')}</p>
                        <ul className="space-y-0.5 text-muted-foreground">
                          {dropped.map((d, i) => (
                            <li key={i}>{f.number(d.row)} · {fieldName(d.field)} · {t(`droppedReason.${d.reason}`)}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                  {stepIdx > 0 ? <Button variant="outline" onClick={() => setStepIdx((i) => i - 1)} disabled={pending}>{t('back')}</Button> : (
                    <Button variant="outline" onClick={reset} disabled={pending}>{t('back')}</Button>
                  )}
                  {stepIdx < steps.length - 1 ? (
                    <Button onClick={() => setStepIdx((i) => i + 1)} disabled={step === 'unknown' && !decisionsReady} data-testid="sales-customer-import-next">{t('next')}</Button>
                  ) : (
                    <Button pending={pending} onClick={doImport} disabled={pending || !decisionsReady || preview.counts.new + preview.counts.match === 0} data-testid="sales-customer-import-import">{t('import')}</Button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">{t('recent')}</p>
              {batches.length === 0 ? <p className="text-sm text-muted-foreground">{t('noRecent')}</p> : (
                <ul className="space-y-1.5">
                  {batches.map((b, i) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{t('batchLine', { date: f.date(b.created_at), created: b.created_count, updated: b.updated_count })}</span>
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => setRemoving(b)} data-testid={`sales-customer-import-batch-remove-${i}`}>{t('remove')}</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </ModalContent>
        </Dialog>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={t('remove')}
          body={t('removeConfirm')}
          confirmLabel={t('remove')}
          cancelLabel={t('back')}
          pending={removePending}
          onConfirm={doRemove}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}
