'use client';

/**
 * FR-94 §16.8 Name matching: fix what an import got wrong without reopening the
 * file — match in-charge names to employees, merge likely duplicate companies,
 * and see / forget the saved matches that later imports reuse.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { matchSalesPerson, mergeSalesCustomers, removeSalesAlias } from '@/lib/actions/sales';
import { similarCustomerGroups } from '@/lib/sales/inquiry';
import type { Bootstrap, CustomerSummary, NameAlias, PersonToMatch } from '@/lib/sales/types';
import { tabClass, tabListClass } from '@/lib/ui/tabs';
import { ConfirmDialog, PersonPick, Select, useRun, useSalesFormat } from './parts';

type Tab = 'people' | 'companies' | 'aliases';

const TH = 'px-3 py-2.5';
const TD = 'whitespace-nowrap px-3 py-2.5';

export function NameMatching({ boot, batch, people, aliases, customers }: {
  boot: Bootstrap; batch: string | null; people: PersonToMatch[]; aliases: NameAlias[]; customers: CustomerSummary[];
}) {
  const t = useTranslations('sales.names');
  const [tab, setTab] = useState<Tab>('people');
  return (
    <div className="flex flex-col gap-5" data-wide data-testid="sales-names">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t('title')}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('intro')}</p>
      </div>
      <div role="tablist" aria-label={t('title')} className={tabListClass}>
        {(['people', 'companies', 'aliases'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tabClass(tab === k)}
            onClick={() => setTab(k)} data-testid={`sales-names-tab-${k}`}>
            {t(k)}
          </button>
        ))}
      </div>
      {tab === 'people' ? <PeopleTab boot={boot} batch={batch} rows={people} /> : null}
      {tab === 'companies' ? <CompaniesTab customers={customers} /> : null}
      {tab === 'aliases' ? <AliasesTab aliases={aliases} /> : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── people

const norm = (s: string) => s.replace(/[يك‌]/g, (c) => (c === 'ي' ? 'ی' : c === 'ك' ? 'ک' : '')).replace(/\s+/g, ' ').trim().toLowerCase();

function PeopleTab({ boot, batch, rows }: { boot: Bootstrap; batch: string | null; rows: PersonToMatch[] }) {
  const t = useTranslations('sales.names');
  const f = useSalesFormat();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  // What each name is set to now: a saved match, else an exact-name suggestion (unsaved).
  const initial = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const r of rows) out[r.name] = r.matched_id ?? boot.people.find((p) => norm(p.name) === norm(r.name))?.id ?? null;
    return out;
  }, [rows, boot.people]);
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const value = (name: string) => (name in picked ? picked[name] : initial[name]);
  const changed = rows.filter((r) => value(r.name) !== r.matched_id);
  const batchInfo = batch ? boot.batches.find((b) => b.id === batch) : null;

  const shown = useMemo(() => {
    const q = norm(query);
    return [...rows].filter((r) => !q || norm(r.name).includes(q)).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [rows, query]);

  async function save() {
    setSaving(true);
    let updated = 0;
    let done = 0;
    try {
      for (const r of changed) {
        const out = await matchSalesPerson(r.name, value(r.name) ?? null);
        if (!out.ok) { toast.error(out.error); break; }
        updated += out.data.updated;
        done += 1;
      }
      if (done > 0) toast.success(t('saved', { count: updated }));
    } finally {
      setSaving(false);
      if (done > 0) { setPicked({}); router.refresh(); }
    }
  }

  const picker = (r: PersonToMatch) => (
    <PersonPick people={boot.people} value={value(r.name) ?? null} onChange={(id) => setPicked({ ...picked, [r.name]: id })}
      testId={`sales-names-person-${r.name}`} ariaLabel={r.name} />
  );
  const mark = (r: PersonToMatch) => (value(r.name) !== r.matched_id ? 'border-s-[3px] border-warning bg-warning/10' : '');

  return (
    <div className="flex flex-col gap-4" data-testid="sales-names-people">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('peopleHint')}</p>
      {batch ? (
        <p className="text-sm" data-testid="sales-names-batch">
          {t('onlyBatch', { date: batchInfo ? f.date(batchInfo.created_at) : '—' })}{' '}
          <Link href={`/${f.locale}/sales/settings/names`} className="text-primary underline underline-offset-2">{t('allImports')}</Link>
        </p>
      ) : null}
      <Input className="sm:max-w-sm" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder={t('search')} aria-label={t('search')} data-testid="sales-names-search" />
      {rows.length === 0 ? <EmptyState message={t('noPeople')} /> : shown.length === 0 ? <EmptyState message={t('noPeople')} /> : (
        <>
          <ul className="flex flex-col divide-y divide-border border-y border-border md:hidden">
            {shown.map((r) => (
              <li key={r.name} className={`flex flex-col gap-2 py-3 ps-2 ${mark(r)}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold"><bdi>{r.name}</bdi></span>
                  <span className="text-xs tabular-nums text-muted-foreground">{t('records')} {f.number(r.count)}</span>
                </span>
                {picker(r)}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto border-b border-border md:block">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className={`${TH} text-start`}>{t('name')}</th>
                  <th className={`${TH} text-end tabular-nums`}>{t('records')}</th>
                  <th className={`${TH} text-start`}>{t('employee')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((r) => (
                  <tr key={r.name} className={mark(r)}>
                    <td className={`${TD} font-medium`}><bdi>{r.name}</bdi></td>
                    <td className={`${TD} text-end tabular-nums`}>{f.number(r.count)}</td>
                    <td className="min-w-72 px-3 py-1.5">{picker(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {changed.length > 0 ? (
        <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-border bg-background px-1 py-3 max-md:bottom-16">
          <Button className="max-sm:h-11 max-sm:flex-1" disabled={saving} onClick={() => void save()} data-testid="sales-names-save">
            {t('save')} ({f.number(changed.length)})
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── companies

function CompaniesTab({ customers }: { customers: CustomerSummary[] }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [into, setInto] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<{ key: string; members: CustomerSummary[]; target: CustomerSummary } | null>(null);

  const groups = useMemo(() => {
    const byName = new Map(customers.map((c) => [c.name.replace(/\s+/g, ' ').trim(), c]));
    return similarCustomerGroups(customers.map((c) => ({ name: c.name, count: c.records })), [])
      .map((g) => ({
        key: g.key,
        members: g.spellings.map((s) => byName.get(s.name)).filter((c): c is CustomerSummary => !!c),
      }))
      .filter((g) => g.members.length >= 2);
  }, [customers]);

  function target(g: { key: string; members: CustomerSummary[] }): CustomerSummary {
    return g.members.find((m) => m.id === into[g.key]) ?? g.members[0];
  }

  return (
    <div className="flex flex-col gap-4" data-testid="sales-names-companies">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('names.dupHint')}</p>
      {groups.length === 0 ? <EmptyState message={t('names.noDuplicates')} /> : (
        <ul className="flex max-w-4xl flex-col divide-y divide-border border-y border-border">
          {groups.map((g) => {
            const chosen = target(g);
            return (
              <li key={g.key} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="sales-names-group">
                <ul className="flex flex-col gap-1 text-sm">
                  {g.members.map((m) => (
                    <li key={m.id} className="flex items-baseline gap-2">
                      <span className={m.id === chosen.id ? 'font-semibold' : ''}><bdi>{m.name}</bdi></span>
                      <span className="text-xs tabular-nums text-muted-foreground">{t('names.records')} {f.number(m.records)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select value={chosen.id} onChange={(v) => setInto({ ...into, [g.key]: v })} ariaLabel={t('names.mergeInto')} className="sm:w-64">
                    {g.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                  <Button variant="outline" className="max-sm:h-11" disabled={pending}
                    onClick={() => setConfirming({ key: g.key, members: g.members, target: chosen })} data-testid="sales-names-merge">
                    {t('names.merge')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {confirming ? (
        <ConfirmDialog
          title={t('names.mergeTitle', { name: confirming.target.name })}
          body={t('names.mergeBody', { name: confirming.target.name, names: confirming.members.filter((m) => m.id !== confirming.target.id).map((m) => m.name).join(f.locale === 'fa' ? '، ' : ', ') })}
          confirmLabel={t('names.merge')} cancelLabel={t('cancel')} pending={pending}
          onClose={() => setConfirming(null)}
          onConfirm={() => void run(async () => {
            for (const m of confirming.members) {
              if (m.id === confirming.target.id) continue;
              const out = await mergeSalesCustomers(m.id, confirming.target.id);
              if (!out.ok) return out;
            }
            return { ok: true };
          }, () => setConfirming(null))}
        />
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── saved matches

function AliasesTab({ aliases }: { aliases: NameAlias[] }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [removing, setRemoving] = useState<NameAlias | null>(null);
  return (
    <div className="flex flex-col gap-4" data-testid="sales-names-aliases">
      {aliases.length === 0 ? <EmptyState message={t('names.noAliases')} /> : (
        <>
          <ul className="flex flex-col divide-y divide-border border-y border-border md:hidden">
            {aliases.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 py-3">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-semibold"><bdi>{a.alias}</bdi></span>
                  <span className="text-xs text-muted-foreground">{t(a.kind === 'person' ? 'names.aliasPerson' : 'names.aliasCustomer')}</span>
                </span>
                <span className="text-sm text-muted-foreground"><bdi>{a.target_name ?? '—'}</bdi> · {f.date(a.created_at)}</span>
                <Button size="sm" variant="ghost" className="self-start text-destructive" onClick={() => setRemoving(a)}>{t('names.aliasRemove')}</Button>
              </li>
            ))}
          </ul>
          <div className="hidden max-w-5xl overflow-x-auto border-b border-border md:block">
            <table className="data-table w-full text-sm">
              <thead>
                <tr>
                  <th className={`${TH} text-start`}>{t('names.aliasKind')}</th>
                  <th className={`${TH} text-start`}>{t('names.aliasSpelling')}</th>
                  <th className={`${TH} text-start`}>{t('names.aliasTarget')}</th>
                  <th className={`${TH} text-start`}>{t('import.when')}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {aliases.map((a) => (
                  <tr key={a.id}>
                    <td className={TD}>{t(a.kind === 'person' ? 'names.aliasPerson' : 'names.aliasCustomer')}</td>
                    <td className={`${TD} font-medium`}><bdi>{a.alias}</bdi></td>
                    <td className={TD}><bdi>{a.target_name ?? '—'}</bdi></td>
                    <td className={TD}>{f.date(a.created_at)}</td>
                    <td className={`${TD} text-end`}>
                      <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setRemoving(a)} data-testid="sales-names-forget">{t('names.aliasRemove')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {removing ? (
        <ConfirmDialog
          title={t('names.aliasRemove')}
          body={t('names.forgetBody', { alias: removing.alias, target: removing.target_name ?? '—' })}
          confirmLabel={t('names.aliasRemove')} cancelLabel={t('cancel')} pending={pending}
          onClose={() => setRemoving(null)}
          onConfirm={() => void run(() => removeSalesAlias(removing.id), () => setRemoving(null))}
        />
      ) : null}
    </div>
  );
}
