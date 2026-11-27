'use client';

/**
 * FR-98 §7: the customer registration / edit form, one scrolling dialog. Only the Farsi name blocks
 * saving: a customer with gaps is saved as a draft and tagged Incomplete (D10). Contact details are
 * private (D8); the SQL decides who sees them, this form is only opened for `customers` holders.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  findSimilarSalesCustomers, getCustomerLists, saveSalesCategory, saveSalesCity, saveSalesCustomer,
} from '@/lib/actions/sales';
import {
  CONTACT_LABELS, cleanContacts, contactState, emptyContactRow, gradeState, gradesPayload, hasPartialContact, hasPartialGrade,
  missingKeys, type ContactRow, type GradeRow,
} from '@/lib/sales/customerForm';
import { customerLabel } from '@/lib/sales/customerLabel';
import { matchAllWords, similarByWords } from '@/lib/sales/customerSearch';
import type {
  CustomerInput, CustomerKind, CustomerLists, CustomerMissingKey, CustomerProfile, CustomerRef, DuplicateCustomer,
} from '@/lib/sales/types';
import { cn } from '@/lib/utils';
import { useViewAs } from '../../_components/ViewAsContext';
import { Field, ModalContent, Select, Tag } from './parts';

const EMPTY_LISTS: CustomerLists = { provinces: [], cities: [], categories: [] };
/** Rows a contractor may hold: the main pair + 9 further pairs (SQL caps `grades` at 9). */
const MAX_GRADES = 10;

let gradeKey = 0;
const newGrade = (rank = '', categoryId: string | null = null): GradeRow => ({ key: ++gradeKey, rank, categoryId });

export function CustomerForm({ customerId, initial, initialName, customers, onSaved, onUse, onClose }: {
  customerId: string | null;
  initial?: CustomerProfile | null;
  initialName?: string;
  customers: CustomerRef[];
  onSaved: (p: CustomerProfile) => void;
  /** The record form's path: "Use this one" returns an existing customer instead of opening it. */
  onUse?: (c: CustomerRef) => void;
  onClose: () => void;
}) {
  const t = useTranslations('sales');
  const locale = useLocale();
  const viewAs = useViewAs();
  const canCreateList = viewAs === null;

  const [lists, setLists] = useState<CustomerLists>(EMPTY_LISTS);
  const [listsReady, setListsReady] = useState(false);
  const [nameFa, setNameFa] = useState(initial?.name ?? initialName ?? '');
  const [nameEn, setNameEn] = useState(initial?.name_en ?? '');
  const [kind, setKind] = useState<CustomerKind | null>(initial?.kind ?? null);
  const [grades, setGrades] = useState<GradeRow[]>(() => [
    newGrade(initial?.rank ? String(initial.rank) : '', initial?.category_id ?? null),
    ...(initial?.grades ?? []).map((g) => newGrade(String(g.rank), g.category_id)),
  ]);
  const [ceo, setCeo] = useState(initial?.ceo_name ?? '');
  const [province, setProvince] = useState(initial?.province_code ?? '');
  const [cityId, setCityId] = useState<string | null>(initial?.city_id ?? null);
  const [address, setAddress] = useState(initial?.address ?? '');
  const [contacts, setContacts] = useState<ContactRow[]>(() =>
    (initial?.contacts ?? []).map((c) => ({
      person: c.person, title: c.title ?? '', label: c.label, phone: c.phone, email: c.email ?? '',
    })));
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState<DuplicateCustomer | null>(null);
  const [remote, setRemote] = useState<CustomerRef[]>([]);
  const [creating, setCreating] = useState<null | CreateState>(null);
  const [nameFocus, setNameFocus] = useState<null | 'fa' | 'en'>(null);
  const [similarHidden, setSimilarHidden] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

  useEffect(() => {
    let live = true;
    getCustomerLists().then((r) => {
      if (!live) return;
      if (r.ok) setLists(r.data); else toast.error(r.error);
      setListsReady(true);
    });
    return () => { live = false; };
  }, []);

  // Registration only: typo-tolerant matches from the server, merged with the local word matches.
  useEffect(() => {
    if (customerId !== null || nameFa.trim().length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      findSimilarSalesCustomers(nameFa.trim()).then((r) => { if (live) setRemote(r.ok ? r.data : []); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [customerId, nameFa]);

  const similar = useMemo(() => {
    if (customerId !== null) return [];
    const local = similarByWords(customers, `${nameFa} ${nameEn}`, 8);
    const seen = new Set<string>();
    const out: CustomerRef[] = [];
    for (const c of [...local, ...(nameFa.trim().length < 2 ? [] : remote)]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out.slice(0, 8);
  }, [customerId, customers, nameFa, nameEn, remote]);

  const input: CustomerInput = {
    name: nameFa.trim(),
    name_en: nameEn.trim() || null,
    kind,
    ceo_name: ceo.trim() || null,
    province_code: province || null,
    city_id: province ? cityId : null,
    address: address.trim() || null,
    ...(kind === 'contractor' ? gradesPayload(grades) : { rank: null, category_id: null, grades: [] }),
    contacts: cleanContacts(contacts),
  };
  const missing = missingKeys(input);
  const flagged = new Set<CustomerMissingKey>(
    (initial?.missing ?? []).filter((k) => missing.includes(k)),
  );
  const partialGrade = kind === 'contractor' && hasPartialGrade(grades);
  // Rows after the main pair that are half filled (the first non-empty row is the main pair).
  const blockedGrades = new Set(grades.filter((g) => gradeState(g) !== 'empty').slice(1)
    .filter((g) => gradeState(g) === 'partial').map((g) => g.key));
  const partial = hasPartialContact(contacts) || partialGrade;
  const canSave = nameFa.trim() !== '' && !partial && !busy;

  const provinceLabel = (p: { name_fa: string; name_en: string }) => (locale === 'en' && p.name_en ? p.name_en : p.name_fa);
  const listLabel = (p: { name_fa: string; name_en: string | null }) => (locale === 'en' && p.name_en ? p.name_en : p.name_fa);
  const categories = lists.categories.filter((c) => c.active || grades.some((g) => g.categoryId === c.id));
  const cities = lists.cities.filter((c) => c.province_code === province && (c.active || c.id === cityId));
  const provinceName = lists.provinces.find((p) => p.code === province);

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setDup(null);
    try {
      const result = await saveSalesCustomer(customerId, input);
      if (!result.ok) {
        if (result.duplicate) setDup(result.duplicate); else toast.error(result.error);
        return;
      }
      toast.success(t(result.data.missing.length > 0 ? 'customerForm.savedDraft' : 'customerForm.saved'));
      onSaved(result.data);
    } finally {
      setBusy(false);
    }
  }

  async function createListEntry() {
    if (!creating || creating.fa.trim() === '' || createBusy) return;
    setCreateBusy(true);
    try {
      const en = creating.en.trim() || null;
      if (creating.what === 'category') {
        const r = await saveSalesCategory({ name_fa: creating.fa.trim(), name_en: en });
        if (!r.ok && !r.duplicate) { toast.error(r.error); return; }
        const row = creating.row;
        if (r.ok) {
          setLists((l) => ({ ...l, categories: [...l.categories, r.data] }));
          updateGrade(row, { categoryId: r.data.id });
        } else if (r.duplicate) updateGrade(row, { categoryId: r.duplicate.id });
      } else {
        const r = await saveSalesCity({ province_code: province, name_fa: creating.fa.trim(), name_en: en });
        if (!r.ok && !r.duplicate) { toast.error(r.error); return; }
        if (r.ok) {
          setLists((l) => ({ ...l, cities: [...l.cities, r.data] }));
          setCityId(r.data.id);
        } else if (r.duplicate) setCityId(r.duplicate.id);
      }
      setCreating(null);
    } finally {
      setCreateBusy(false);
    }
  }

  function updateGrade(key: number | undefined, patch: Partial<GradeRow>) {
    setGrades((rows) => rows.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }
  const showSimilar = similar.length > 0 && !similarHidden;
  const nameKeys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && showSimilar && nameFocus) { e.preventDefault(); e.stopPropagation(); setSimilarHidden(true); }
  };
  const similarList = (
    <SimilarDropdown items={similar} locale={locale} onUse={onUse} onPicked={() => setSimilarHidden(true)} />
  );

  const updateContact = (i: number, patch: Partial<ContactRow>) =>
    setContacts((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const flag = (k: CustomerMissingKey) => flagged.has(k);
  const note = (k: CustomerMissingKey) => (flag(k) ? <span className="text-xs text-destructive">{t('customerForm.missingField')}</span> : null);
  const invalidCls = (k: CustomerMissingKey) => (flag(k) ? 'border-destructive' : undefined);

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <ModalContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="sales-customer-form">
        <DialogHeader>
          <DialogTitle>{t(customerId ? 'customerForm.titleEdit' : 'customerForm.titleNew')}</DialogTitle>
          <DialogDescription>{t('customerForm.intro')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3" aria-label={t('customerForm.sectionNames')}>
            <h3 className="text-sm font-semibold">{t('customerForm.sectionNames')}</h3>
            <NameField label={t('customerForm.name')} field="fa" focus={nameFocus} setFocus={setNameFocus}
              dropdown={showSimilar ? similarList : null}>
              {(id, listId) => (
                <Input id={id} maxLength={200} value={nameFa} autoComplete="off"
                  role="combobox" aria-autocomplete="list" aria-controls={listId}
                  onChange={(e) => { setNameFa(e.target.value); setDup(null); setSimilarHidden(false); }}
                  onKeyDown={nameKeys} aria-expanded={showSimilar && nameFocus === 'fa'}
                  aria-invalid={dup !== null} data-testid="sales-customer-form-name" />
              )}
            </NameField>
            <NameField label={t('customerForm.nameEn')} hint={t('customerForm.nameEnHint')} field="en" focus={nameFocus} setFocus={setNameFocus}
              dropdown={showSimilar ? similarList : null}>
              {(id, listId) => (
                <Input id={id} maxLength={200} dir="ltr" value={nameEn} autoComplete="off"
                  role="combobox" aria-autocomplete="list" aria-controls={listId}
                  onChange={(e) => { setNameEn(e.target.value); setDup(null); setSimilarHidden(false); }}
                  onKeyDown={nameKeys} aria-expanded={showSimilar && nameFocus === 'en'}
                  className={invalidCls('name_en')} data-testid="sales-customer-form-name-en" />
              )}
            </NameField>
            {note('name_en')}
            {dup ? (
              <p className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert" data-testid="sales-customer-form-duplicate">
                <span>{t('customerForm.duplicate', { name: customerLabel(dup, locale) })}</span>
                {onUse ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => onUse({ id: dup.id, name: dup.name, name_en: dup.name_en, kind: null })}>
                    {t('customerForm.useThis')}
                  </Button>
                ) : (
                  <Link href={`/${locale}/sales/customers/${dup.id}`} className="underline">{t('customerForm.open')}</Link>
                )}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-3" aria-label={t('customerForm.sectionType')}>
            <h3 className="text-sm font-semibold">{t('customerForm.sectionType')}</h3>
            <div role="group" aria-label={t('customerForm.kind')} className={cn('flex w-full gap-2 md:w-80', flag('kind') && 'outline outline-1 outline-destructive')}>
              {(['government', 'contractor'] as const).map((k) => (
                <Button key={k} type="button" variant={kind === k ? 'default' : 'outline'} className="flex-1" aria-pressed={kind === k}
                  onClick={() => setKind(kind === k ? null : k)} data-testid={`sales-customer-form-kind-${k}`}>
                  {t(`customerKind.${k}`)}
                </Button>
              ))}
            </div>
            {note('kind')}
            {kind === 'contractor' ? (
              <div className="flex flex-col gap-3" data-testid="sales-customer-form-grades">
                {grades.map((g, i) => (
                  <div key={g.key} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-start" data-testid={`sales-customer-form-grade-${i}`}>
                    <Field label={t('customerForm.rank')}>
                      <Select value={g.rank} onChange={(v) => updateGrade(g.key, { rank: v })}
                        className={i === 0 ? invalidCls('rank') : blockedGrades.has(g.key) && !g.rank ? 'border-destructive' : undefined}
                        testId={i === 0 ? 'sales-customer-form-rank' : `sales-customer-form-rank-${i}`}>
                        <option value="">{t('customerForm.pick')}</option>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>{t('customerForm.rankOption', { rank: n })}</option>)}
                      </Select>
                      {i === 0 ? note('rank') : null}
                    </Field>
                    <div className="flex min-w-0 flex-col gap-1.5 text-sm">
                      <span className="font-medium">{t('customerForm.category')}</span>
                      <ListPick
                        options={categories.map((c) => ({ id: c.id, label: listLabel(c), search: [c.name_fa, c.name_en] }))}
                        value={g.categoryId}
                        onChange={(id) => updateGrade(g.key, { categoryId: id })}
                        loading={!listsReady}
                        allowCreate={canCreateList}
                        onCreate={(typed) => setCreating({ what: 'category', fa: typed, en: '', row: g.key })}
                        invalid={i === 0 ? flag('category') : blockedGrades.has(g.key) && !g.categoryId}
                        testId={i === 0 ? 'sales-customer-form-category' : `sales-customer-form-category-${i}`}
                      />
                      {i === 0 ? note('category') : null}
                    </div>
                    {grades.length > 1 ? (
                      <Button type="button" variant="outline" className="self-start sm:mt-[calc(1lh+0.375rem)]"
                        onClick={() => { setGrades((rows) => rows.filter((r) => r.key !== g.key)); if (creating?.row === g.key) setCreating(null); }}
                        aria-label={t('customerForm.removeGradeAria', { n: i + 1 })} data-testid={`sales-customer-form-remove-grade-${i}`}>
                        <X aria-hidden />{t('customerForm.removeGrade')}
                      </Button>
                    ) : null}
                    {blockedGrades.has(g.key) ? (
                      <p className="text-xs text-destructive sm:col-span-full" role="alert">{t('customerForm.gradeIncomplete')}</p>
                    ) : null}
                    {creating?.what === 'category' && creating.row === g.key ? (
                      <CreatePanel title={t('customerForm.newCategory')} state={creating} setState={setCreating} busy={createBusy} onCreate={createListEntry} />
                    ) : null}
                  </div>
                ))}
                <Button type="button" variant="outline" className="self-start" disabled={grades.length >= MAX_GRADES}
                  onClick={() => setGrades((rows) => [...rows, newGrade()])} data-testid="sales-customer-form-add-grade">
                  <Plus aria-hidden />{t('customerForm.addGrade')}
                </Button>
              </div>
            ) : null}
          </section>

          <section className="flex flex-col gap-3" aria-label={t('customerForm.sectionCeo')}>
            <Field label={t('customerForm.ceo')}>
              <Input maxLength={120} value={ceo} onChange={(e) => setCeo(e.target.value)} className={invalidCls('ceo_name')} data-testid="sales-customer-form-ceo" />
              {note('ceo_name')}
            </Field>
          </section>

          <section className="flex flex-col gap-3" aria-label={t('customerForm.sectionAddress')}>
            <h3 className="text-sm font-semibold">{t('customerForm.sectionAddress')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('customerForm.province')}>
                <Select value={province} onChange={(v) => { setProvince(v); setCityId(null); setCreating(null); }}
                  className={invalidCls('province')} testId="sales-customer-form-province">
                  <option value="">{t('customerForm.pick')}</option>
                  {lists.provinces.map((p) => <option key={p.code} value={p.code}>{provinceLabel(p)}</option>)}
                </Select>
                {note('province')}
              </Field>
              <div className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('customerForm.city')}</span>
                <ListPick
                  options={cities.map((c) => ({ id: c.id, label: listLabel(c), search: [c.name_fa, c.name_en] }))}
                  value={cityId}
                  onChange={(id) => setCityId(id)}
                  loading={!listsReady}
                  disabled={!province}
                  allowCreate={canCreateList}
                  onCreate={(typed) => setCreating({ what: 'city', fa: typed, en: '' })}
                  invalid={flag('city')}
                  testId="sales-customer-form-city"
                />
                {!province ? <span className="text-xs text-muted-foreground">{t('customerForm.cityNeedsProvince')}</span> : null}
                {note('city')}
              </div>
              {creating?.what === 'city' && provinceName ? (
                <CreatePanel title={t('customerForm.newCity', { province: provinceLabel(provinceName) })} state={creating} setState={setCreating} busy={createBusy} onCreate={createListEntry} />
              ) : null}
            </div>
            <Field label={t('customerForm.address')}>
              <Textarea maxLength={500} value={address} onChange={(e) => setAddress(e.target.value)}
                className={invalidCls('address')} data-testid="sales-customer-form-address" />
              {note('address')}
            </Field>
          </section>

          <section className="flex flex-col gap-3" aria-label={t('customerForm.sectionContacts')}>
            <h3 className="text-sm font-semibold">{t('customerForm.sectionContacts')}</h3>
            {contacts.length === 0 ? <p className="text-sm text-muted-foreground">{t('customerForm.noContacts')}</p> : null}
            {flag('contacts') ? note('contacts') : null}
            <ul className="flex flex-col gap-3">
              {contacts.map((r, i) => (
                <li key={i} className="flex flex-col gap-2 border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={t('customerForm.contactPerson')}>
                      <Input maxLength={120} value={r.person} onChange={(e) => updateContact(i, { person: e.target.value })}
                        aria-invalid={contactState(r) === 'partial' && r.person.trim() === ''} data-testid={`sales-customer-form-contact-person-${i}`} />
                    </Field>
                    <Field label={t('customerForm.contactTitle')}>
                      <Input maxLength={80} value={r.title} onChange={(e) => updateContact(i, { title: e.target.value })} data-testid={`sales-customer-form-contact-title-${i}`} />
                    </Field>
                    <Field label={t('customerForm.contactLabel')}>
                      <Select value={r.label} onChange={(v) => updateContact(i, { label: v as ContactRow['label'] })} testId={`sales-customer-form-contact-label-${i}`}>
                        {CONTACT_LABELS.map((l) => <option key={l} value={l}>{t(`contactLabel.${l}`)}</option>)}
                      </Select>
                    </Field>
                    <Field label={t('customerForm.contactPhone')}>
                      <Input dir="ltr" inputMode="tel" maxLength={30} value={r.phone} onChange={(e) => updateContact(i, { phone: e.target.value })}
                        aria-invalid={contactState(r) === 'partial' && r.phone.trim() === ''} data-testid={`sales-customer-form-contact-phone-${i}`} />
                    </Field>
                    <Field label={t('customerForm.contactEmail')} className="sm:col-span-2">
                      <Input dir="ltr" type="email" inputMode="email" maxLength={200} value={r.email} onChange={(e) => updateContact(i, { email: e.target.value })} data-testid={`sales-customer-form-contact-email-${i}`} />
                    </Field>
                  </div>
                  {contactState(r) === 'partial' ? <p className="text-xs text-destructive" role="alert">{t('customerForm.contactIncomplete')}</p> : null}
                  <Button type="button" size="sm" variant="outline" className="self-start"
                    onClick={() => setContacts((rows) => rows.filter((_, j) => j !== i))} data-testid={`sales-customer-form-remove-contact-${i}`}>
                    <X aria-hidden />{t('customerForm.removeContact')}
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" className="self-start" onClick={() => setContacts((rows) => [...rows, emptyContactRow()])} data-testid="sales-customer-form-add-contact">
              <Plus aria-hidden />{t('customerForm.addContact')}
            </Button>
          </section>
        </div>

        <DialogFooter className="items-center gap-2 max-sm:flex-col-reverse sm:justify-between">
          <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="sales-customer-form-missing">
            {missing.length > 0 ? t('customerForm.missingCount', { count: missing.length }) : null}
          </p>
          <div className="flex gap-2 max-sm:w-full max-sm:flex-col-reverse">
            <Button type="button" variant="outline" className="max-sm:h-11" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
            <Button type="button" pending={busy} className="max-sm:h-11" disabled={!canSave} onClick={save} data-testid="sales-customer-form-save">
              {t(missing.length > 0 ? 'customerForm.saveDraft' : 'customerForm.save')}
            </Button>
          </div>
        </DialogFooter>
      </ModalContent>
    </Dialog>
  );
}

/** A list entry being created from a picker; `row` = the rank / category row it fills. */
type CreateState = { what: 'category' | 'city'; fa: string; en: string; row?: number };

/** Small inline confirm for a new category / city: Farsi name + optional English name. */
function CreatePanel({ title, state, setState, busy, onCreate }: {
  title: string;
  state: CreateState;
  setState: (s: CreateState | null) => void;
  busy: boolean;
  onCreate: () => void;
}) {
  const t = useTranslations('sales');
  return (
    <div className="flex flex-col gap-2 border border-border p-3 sm:col-span-full" data-testid={`sales-customer-form-new-${state.what}`}>
      <span className="text-sm font-medium">{title}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('customerForm.nameFa')}>
          <Input maxLength={80} value={state.fa} onChange={(e) => setState({ ...state, fa: e.target.value })} data-testid={`sales-customer-form-new-${state.what}-fa`} />
        </Field>
        <Field label={t('customerForm.nameEnOptional')}>
          <Input dir="ltr" maxLength={80} value={state.en} onChange={(e) => setState({ ...state, en: e.target.value })} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="button" size="sm" pending={busy} disabled={busy || state.fa.trim() === ''} onClick={onCreate} data-testid={`sales-customer-form-new-${state.what}-create`}>
          {t('customerForm.create')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setState(null)}>{t('cancel')}</Button>
      </div>
    </div>
  );
}

/**
 * A name input with the "is it one of these?" matches as a dropdown under it (owner, 2026-11-26:
 * a list growing below the fields went unnoticed). Shown while this field has focus.
 */
function NameField({ label, hint, field, focus, setFocus, dropdown, children }: {
  label: string;
  hint?: string;
  field: 'fa' | 'en';
  focus: null | 'fa' | 'en';
  setFocus: (f: null | 'fa' | 'en' | ((f: null | 'fa' | 'en') => null | 'fa' | 'en')) => void;
  dropdown: React.ReactNode;
  children: (id: string, listId: string) => React.ReactNode;
}) {
  const id = useId();
  const listId = `${id}-similar`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium text-foreground">{label}</label>
      <div
        className="relative"
        onFocus={() => setFocus(field)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setFocus((f) => (f === field ? null : f));
        }}
      >
        {children(id, listId)}
        {focus === field && dropdown ? <div id={listId} className="contents">{dropdown}</div> : null}
      </div>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function SimilarDropdown({ items, locale, onUse, onPicked }: {
  items: CustomerRef[];
  locale: string;
  onUse?: (c: CustomerRef) => void;
  onPicked: () => void;
}) {
  const t = useTranslations('sales');
  return (
    <div
      className="absolute inset-x-0 top-full z-50 mt-1 border border-border bg-popover text-sm text-popover-foreground"
      // Keep focus in the field: a press inside the list must not close it before the click lands.
      onMouseDown={(e) => e.preventDefault()}
      data-testid="sales-customer-form-similar"
    >
      <p className="border-b border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">{t('customerForm.similarTitle')}</p>
      <ul className="max-h-60 divide-y divide-border overflow-y-auto">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <bdi className="min-w-0 break-words">{customerLabel(c, locale)}</bdi>
              {c.incomplete ? <Tag tone="warn">{t('customerProfile.incomplete')}</Tag> : null}
            </span>
            {onUse ? (
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => { onPicked(); onUse(c); }}>
                {t('customerForm.useThis')}
              </Button>
            ) : (
              <Link href={`/${locale}/sales/customers/${c.id}`} className="shrink-0 text-sm text-primary underline" onClick={onPicked}>
                {t('customerForm.open')}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type PickOption = { id: string; label: string; search: (string | null)[] };

/** A searchable single pick (category, city) with a final "Create …" option. */
function ListPick({ options, value, onChange, loading, disabled, allowCreate, onCreate, invalid, testId }: {
  options: PickOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  loading: boolean;
  disabled?: boolean;
  allowCreate: boolean;
  onCreate: (typed: string) => void;
  invalid?: boolean;
  testId: string;
}) {
  const t = useTranslations('sales');
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;
  const [text, setText] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // The picked value changed from outside (province change cleared the city): show it.
  const seenKey = `${value ?? ''}|${selected?.label ?? ''}`;
  const [seen, setSeen] = useState(seenKey);
  if (seen !== seenKey) { setSeen(seenKey); setText(selected?.label ?? ''); }

  if (loading) return <Skeleton className="h-9 w-full" />;

  const typed = text.trim();
  const shown = selected && text === selected.label ? options : options.filter((o) => matchAllWords([o.label, ...o.search], text));
  const exact = options.some((o) => matchAllWords([o.label, ...o.search], typed) && [o.label, ...o.search].some((s) => s?.trim() === typed));
  const canCreate = allowCreate && typed !== '' && !exact;
  const count = shown.length + (canCreate ? 1 : 0);

  const commit = (o: PickOption) => { onChange(o.id); setText(o.label); setOpen(false); };
  const pickAt = (i: number) => {
    if (i < shown.length) commit(shown[i]);
    else if (canCreate) { setOpen(false); onCreate(typed); }
  };
  const revert = () => { setText(selected?.label ?? ''); setOpen(false); };

  return (
    <div
      ref={wrap}
      className="relative"
      onBlur={(e) => {
        if (wrap.current?.contains(e.relatedTarget as Node | null)) return;
        if (typed === '' && value) onChange(null);
        else revert();
        setOpen(false);
      }}
    >
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-invalid={invalid}
        autoComplete="off"
        disabled={disabled}
        maxLength={80}
        value={text}
        placeholder={t('customerForm.pick')}
        data-testid={testId}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, count - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { if (open) { e.preventDefault(); if (count > 0) pickAt(Math.min(active, count - 1)); } }
          else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); revert(); }
        }}
      />
      {open && !disabled ? (
        <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-48 overflow-y-auto border border-border bg-popover text-sm text-popover-foreground">
          {shown.map((o, i) => (
            <li key={o.id} role="option" aria-selected={o.id === value}
              className={cn('cursor-pointer px-3 py-2', i === active && 'bg-accent text-accent-foreground')}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pickAt(i)}>
              <bdi>{o.label}</bdi>
            </li>
          ))}
          {canCreate ? (
            <li role="option" aria-selected={false}
              className={cn('cursor-pointer border-t border-border px-3 py-2 font-medium text-primary', shown.length === active && 'bg-accent')}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(shown.length)} onClick={() => pickAt(shown.length)}
              data-testid={`${testId}-create`}>
              {t('customerForm.createOption', { name: typed })}
            </li>
          ) : null}
          {count === 0 ? <li role="presentation" className="px-3 py-2 text-muted-foreground">{t('customerForm.noMatch')}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
