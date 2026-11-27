'use client';

/** Settings › Customer lists: contractor categories, cities (by province) and key-person titles, add / rename / hide. */

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { getCustomerLists, saveContactTitle, saveSalesCategory, saveSalesCity } from '@/lib/actions/sales';
import type { Bootstrap, City, ContactTitle, ContractorCategory, CustomerLists } from '@/lib/sales/types';
import { useViewAs } from '../../_components/ViewAsContext';
import { Field, Select, Tag } from './parts';

type Edit =
  | { kind: 'category'; item: ContractorCategory | null }
  | { kind: 'city'; item: City | null }
  | { kind: 'title'; item: ContactTitle | null };

export function CustomerListsEditor({ boot }: { boot: Bootstrap }) {
  const t = useTranslations('sales');
  const locale = useLocale();
  const viewing = useViewAs() !== null;
  const can = boot.caps.settings && !viewing;
  const [lists, setLists] = useState<CustomerLists | null>(null);
  const [province, setProvince] = useState('');
  const [editing, setEditing] = useState<Edit | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((out: Awaited<ReturnType<typeof getCustomerLists>>) => {
    if (!out.ok) { toast.error(out.error); return; }
    setLists(out.data);
    setProvince((p) => p || out.data.provinces[0]?.code || '');
  }, []);
  const load = useCallback(async () => { apply(await getCustomerLists()); }, [apply]);
  useEffect(() => {
    let live = true;
    void getCustomerLists().then((out) => { if (live) apply(out); });
    return () => { live = false; };
  }, [apply]);

  const name = (x: { name_fa: string; name_en: string | null }) => (locale === 'en' ? x.name_en || x.name_fa : x.name_fa);

  /** Run one or more saves; reload the lists afterwards. */
  const run = async (action: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> => {
    setBusy(true);
    try {
      const out = await action();
      if (!out.ok) { toast.error(out.error ?? ''); return false; }
      await load();
      return true;
    } finally { setBusy(false); }
  };

  if (!lists) return <p className="text-sm text-muted-foreground" aria-busy="true">…</p>;

  const categories = [...lists.categories].sort((a, b) => a.position - b.position || a.name_fa.localeCompare(b.name_fa));
  const titles = [...lists.titles].sort((a, b) => a.position - b.position || a.name_fa.localeCompare(b.name_fa));
  const cities = lists.cities.filter((c) => c.province_code === province).sort((a, b) => a.name_fa.localeCompare(b.name_fa, 'fa'));

  const moveCategory = (i: number, by: number) => {
    if (!categories[i + by]) return Promise.resolve(false);
    const next = [...categories];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    // Renumber 1..n so tied positions cannot leave the order ambiguous; only changed rows are saved.
    return run(async () => {
      for (const [n, c] of next.entries()) {
        if (c.position === n + 1) continue;
        const done = await saveSalesCategory({ id: c.id, name_fa: c.name_fa, name_en: c.name_en, position: n + 1 });
        if (!done.ok) return done;
      }
      return { ok: true };
    });
  };

  const moveTitle = (i: number, by: number) => {
    if (!titles[i + by]) return Promise.resolve(false);
    const next = [...titles];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return run(async () => {
      for (const [n, c] of next.entries()) {
        if (c.position === n + 1) continue;
        const done = await saveContactTitle({ id: c.id, name_fa: c.name_fa, position: n + 1 });
        if (!done.ok) return done;
      }
      return { ok: true };
    });
  };

  const headerRow = (
    <tr>
      <th className="text-start">{t('customerLists.nameFa')}</th>
      <th className="text-start">{t('customerLists.nameEn')}</th>
      <th />
      {can ? <th /> : null}
    </tr>
  );

  return (
    <div className="flex flex-col gap-8" data-testid="sales-customer-lists">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('customerLists.intro')}</p>

      <section className="flex max-w-4xl flex-col gap-3">
        <h3 className="text-base font-semibold">{t('customerLists.categories')}</h3>
        {can ? (
          <div>
            <Button size="sm" variant="outline" onClick={() => setEditing({ kind: 'category', item: null })} data-testid="sales-lists-category-add">
              <Plus aria-hidden="true" /> {t('customerLists.add')}
            </Button>
          </div>
        ) : null}
        {categories.length === 0 ? <p className="text-sm text-muted-foreground">{t('customerLists.empty')}</p> : (
          <div className="overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm">
              <thead>{headerRow}</thead>
              <tbody className="divide-y divide-border">
                {categories.map((c, i) => (
                  <tr key={c.id} className={c.active ? undefined : 'text-muted-foreground'} data-testid={`sales-lists-category-row-${i}`}>
                    <td>{c.name_fa}</td>
                    <td dir="ltr" className="text-start">{c.name_en ?? '—'}</td>
                    <td>{c.active ? null : <Tag>{t('customerLists.hidden')}</Tag>}</td>
                    {can ? (
                      <td className="whitespace-nowrap text-end">
                        <Button size="icon-sm" variant="ghost" disabled={busy || i === 0} aria-label={t('customerLists.moveUp')} onClick={() => void moveCategory(i, -1)}><ArrowUp /></Button>
                        <Button size="icon-sm" variant="ghost" disabled={busy || i === categories.length - 1} aria-label={t('customerLists.moveDown')} onClick={() => void moveCategory(i, 1)}><ArrowDown /></Button>
                        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing({ kind: 'category', item: c })}>{t('customerLists.edit')}</Button>
                        <Button size="xs" variant="ghost" disabled={busy}
                          onClick={() => void run(() => saveSalesCategory({ id: c.id, name_fa: c.name_fa, name_en: c.name_en, active: !c.active }))}>
                          {c.active ? t('customerLists.hide') : t('customerLists.show')}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex max-w-4xl flex-col gap-3">
        <h3 className="text-base font-semibold">{t('customerLists.cities')}</h3>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('customerLists.province')} className="w-64">
            <Select value={province} onChange={setProvince} testId="sales-lists-city-province">
              {lists.provinces.map((p) => <option key={p.code} value={p.code}>{name(p)}</option>)}
            </Select>
          </Field>
          {can ? (
            <Button size="sm" variant="outline" disabled={!province} onClick={() => setEditing({ kind: 'city', item: null })} data-testid="sales-lists-city-add">
              <Plus aria-hidden="true" /> {t('customerLists.add')}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{t('customerLists.count', { count: cities.length })}</p>
        {cities.length === 0 ? <p className="text-sm text-muted-foreground">{t('customerLists.empty')}</p> : (
          <div className="overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm">
              <thead>{headerRow}</thead>
              <tbody className="divide-y divide-border">
                {cities.map((c, i) => (
                  <tr key={c.id} className={c.active ? undefined : 'text-muted-foreground'} data-testid={`sales-lists-city-row-${i}`}>
                    <td>{c.name_fa}</td>
                    <td dir="ltr" className="text-start">{c.name_en ?? '—'}</td>
                    <td>{c.active ? null : <Tag>{t('customerLists.hidden')}</Tag>}</td>
                    {can ? (
                      <td className="whitespace-nowrap text-end">
                        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing({ kind: 'city', item: c })}>{t('customerLists.edit')}</Button>
                        <Button size="xs" variant="ghost" disabled={busy}
                          onClick={() => void run(() => saveSalesCity({ id: c.id, name_fa: c.name_fa, name_en: c.name_en, active: !c.active }))}>
                          {c.active ? t('customerLists.hide') : t('customerLists.show')}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex max-w-4xl flex-col gap-3">
        <h3 className="text-base font-semibold">{t('customerLists.titles')}</h3>
        {can ? (
          <div>
            <Button size="sm" variant="outline" onClick={() => setEditing({ kind: 'title', item: null })} data-testid="sales-lists-title-add">
              <Plus aria-hidden="true" /> {t('customerLists.addTitle')}
            </Button>
          </div>
        ) : null}
        {titles.length === 0 ? <p className="text-sm text-muted-foreground">{t('customerLists.empty')}</p> : (
          <div className="overflow-x-auto border-b border-border">
            <table className="data-table w-full text-sm">
              <thead>{headerRow}</thead>
              <tbody className="divide-y divide-border">
                {titles.map((c, i) => (
                  <tr key={c.id} className={c.active ? undefined : 'text-muted-foreground'} data-testid={`sales-lists-title-row-${i}`}>
                    <td>{c.name_fa}</td>
                    <td dir="ltr" className="text-start">{c.name_en ?? '—'}</td>
                    <td>{c.active ? null : <Tag>{t('customerLists.hidden')}</Tag>}</td>
                    {can ? (
                      <td className="whitespace-nowrap text-end">
                        <Button size="icon-sm" variant="ghost" disabled={busy || i === 0} aria-label={t('customerLists.moveUp')} onClick={() => void moveTitle(i, -1)}><ArrowUp /></Button>
                        <Button size="icon-sm" variant="ghost" disabled={busy || i === titles.length - 1} aria-label={t('customerLists.moveDown')} onClick={() => void moveTitle(i, 1)}><ArrowDown /></Button>
                        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setEditing({ kind: 'title', item: c })}>{t('customerLists.edit')}</Button>
                        <Button size="xs" variant="ghost" disabled={busy}
                          onClick={() => void run(() => saveContactTitle({ id: c.id, name_fa: c.name_fa, active: !c.active }))}>
                          {c.active ? t('customerLists.hide') : t('customerLists.show')}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && can ? (
        <NameDialog
          title={editing.item ? t('customerLists.edit') : editing.kind === 'title' ? t('customerLists.addTitle') : t('customerLists.add')}
          initial={editing.item}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(fa, en) => run(() => (editing.kind === 'category'
            ? saveSalesCategory({
              ...(editing.item ? { id: editing.item.id } : { position: lists.categories.length + 1 }),
              name_fa: fa, name_en: en,
            })
            : editing.kind === 'title'
            ? saveContactTitle({
              ...(editing.item ? { id: editing.item.id } : { position: lists.titles.length + 1 }),
              name_fa: fa, name_en: en,
            })
            : saveSalesCity({
              ...(editing.item ? { id: editing.item.id } : { province_code: province }),
              name_fa: fa, name_en: en,
            }))).then((ok) => { if (ok) setEditing(null); })}
        />
      ) : null}
    </div>
  );
}

function NameDialog({ title, initial, busy, onClose, onSave }: {
  title: string; initial: { name_fa: string; name_en: string | null } | null; busy: boolean;
  onClose: () => void; onSave: (nameFa: string, nameEn: string | null) => Promise<void>;
}) {
  const t = useTranslations('sales');
  const [nameFa, setNameFa] = useState(initial?.name_fa ?? '');
  const [nameEn, setNameEn] = useState(initial?.name_en ?? '');
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <Field label={t('customerLists.nameFa')}>
            <Input maxLength={80} value={nameFa} onChange={(e) => setNameFa(e.target.value)} data-testid="sales-lists-name-fa" />
          </Field>
          <Field label={t('customerLists.nameEn')}>
            <Input dir="ltr" maxLength={80} value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-testid="sales-lists-name-en" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button pending={busy} disabled={busy || nameFa.trim() === ''} data-testid="sales-lists-save"
            onClick={() => void onSave(nameFa.trim(), nameEn.trim() || null)}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
