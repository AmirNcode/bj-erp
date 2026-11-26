'use client';

/**
 * FR-94: the one form that creates and edits a Sales record. Short on purpose
 * (intake must not take longer than adding an Excel row): the bid block for an
 * RFP, the contract block for a contract, then the company's extra fields.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saveSalesRecord } from '@/lib/actions/sales';
import { type Bootstrap, type CustomValues, type FlowKind, type RecordRow } from '@/lib/sales/types';
import { CustomerCombo } from './CustomerCombo';
import { CustomFieldInput, DateInput, Field, NumberInput, PersonPick, Select, useRun, useSalesFormat } from './parts';

type Draft = {
  record_no: number | null;
  title: string;
  buyer_id: string;
  client_id: string;
  customer_ref: string;
  project_site: string;
  source: string;
  description: string;
  received_on: string | null;
  owner_id: string | null;
  currency: string;
  revision: number | null;
  needs_quote: boolean;
  needs_bond: boolean;
  proposal_due: string | null;
  quote_due: string | null;
  bond_due: string | null;
  our_price: number | null;
  total_value: number | null;
  order_date: string | null;
  contract_start: string | null;
  delivery_amount: number | null;
  delivery_unit: string;
  delivery_text: string;
  delivery_date: string | null;
  prepayment: string;
  prepayment_date: string | null;
  addendum: string;
  custom: CustomValues;
};

const tri = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');
const fromTri = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null);

function initial(boot: Bootstrap, record: RecordRow | null, flowKind: FlowKind): Draft {
  return {
    record_no: record ? record.record_no : boot.settings.next_record_no,
    title: record?.title ?? '',
    buyer_id: record?.buyer_id ?? '',
    client_id: record?.client_id ?? '',
    customer_ref: record?.customer_ref ?? '',
    project_site: record?.project_site ?? '',
    source: record?.source ?? '',
    description: record?.description ?? '',
    received_on: record?.received_on ?? null,
    owner_id: record ? record.owner_id : boot.me,
    currency: record?.currency ?? '',
    revision: record?.revision ?? 0,
    needs_quote: record?.needs_quote ?? false,
    needs_bond: record?.needs_bond ?? false,
    proposal_due: record?.proposal_due ?? null,
    quote_due: record?.quote_due ?? null,
    bond_due: record?.bond_due ?? null,
    our_price: record?.our_price ?? null,
    total_value: record?.total_value ?? null,
    order_date: record?.order_date ?? null,
    contract_start: record?.contract_start ?? null,
    delivery_amount: record?.delivery_amount ?? null,
    delivery_unit: record?.delivery_unit ?? (flowKind === 'contract' ? 'month' : ''),
    delivery_text: record?.delivery_text ?? '',
    delivery_date: record?.delivery_date ?? null,
    prepayment: tri(record?.prepayment),
    prepayment_date: record?.prepayment_date ?? null,
    addendum: tri(record?.addendum),
    custom: { ...(record?.custom ?? {}) },
  };
}

export function RecordForm({ boot, record, flowKind, pricedByItems, onDone, onCancel }: {
  boot: Bootstrap;
  /** null = a new record. */
  record: RecordRow | null;
  flowKind: FlowKind;
  /** Our price is the sum of the item prices: not typed here. */
  pricedByItems?: boolean;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [d, setD] = useState<Draft>(() => initial(boot, record, flowKind));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((prev) => ({ ...prev, [key]: value }));
  const fields = boot.fields.filter((x) => x.entity === 'rfp' && (x.active || d.custom[x.key] !== undefined));
  const customerById = (id: string) => boot.customers.find((c) => c.id === id) ?? null;
  const bid = flowKind === 'bid';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {
      title: d.title,
      buyer_id: d.buyer_id || null,
      client_id: d.client_id || null,
      customer_ref: d.customer_ref || null,
      project_site: d.project_site || null,
      source: d.source || null,
      description: d.description || null,
      received_on: d.received_on,
      owner_id: d.owner_id,
      currency: d.currency || null,
      revision: d.revision ?? 0,
      custom: d.custom,
    };
    if (bid) {
      Object.assign(patch, {
        needs_quote: d.needs_quote, needs_bond: d.needs_bond, proposal_due: d.proposal_due,
        quote_due: d.needs_quote ? d.quote_due : null, bond_due: d.needs_bond ? d.bond_due : null,
      });
      if (boot.caps.prices_edit && !pricedByItems) patch.our_price = d.our_price;
    } else {
      Object.assign(patch, {
        order_date: d.order_date, contract_start: d.contract_start, delivery_amount: d.delivery_amount,
        delivery_unit: d.delivery_unit || null, delivery_text: d.delivery_text || null, delivery_date: d.delivery_date,
        prepayment: fromTri(d.prepayment), prepayment_date: d.prepayment_date, addendum: fromTri(d.addendum),
      });
      if (boot.caps.prices_edit) patch.total_value = d.total_value;
    }
    if (!record) Object.assign(patch, { flow_kind: flowKind, record_no: d.record_no });
    let id = record?.id ?? '';
    await run(async () => {
      const result = await saveSalesRecord(record?.id ?? null, patch);
      if (result.ok && result.id) id = result.id;
      return result;
    }, () => onDone(id));
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5" data-testid="sales-record-form">
      <div className="grid gap-4 sm:grid-cols-2">
        {!record ? (
          <Field label={t('field.record_no')} hint={t('form.recordNoHint')}>
            <NumberInput value={d.record_no} onChange={(n) => set('record_no', n)} testId="sales-form-record-no" />
          </Field>
        ) : null}
        <Field label={t('field.title')} className={record ? 'sm:col-span-2' : undefined}>
          <Input required maxLength={300} value={d.title} onChange={(e) => set('title', e.target.value)} placeholder={t('form.titlePlaceholder')} data-testid="sales-form-title" />
        </Field>
        <Field label={t('field.buyer')}>
          <CustomerCombo
            customers={boot.customers}
            value={customerById(d.buyer_id)}
            onChange={(c) => set('buyer_id', c?.id ?? '')}
            allowCreate={boot.caps.customers}
            testId="sales-form-buyer"
          />
        </Field>
        <Field label={t('field.client')} hint={t('form.clientHint')}>
          <CustomerCombo customers={boot.customers} value={customerById(d.client_id)} onChange={(c) => set('client_id', c?.id ?? '')} allowCreate={boot.caps.customers} testId="sales-form-client" />
        </Field>
        <Field label={t('field.customer_ref')}>
          <Input dir="ltr" maxLength={200} value={d.customer_ref} onChange={(e) => set('customer_ref', e.target.value)} />
        </Field>
        <Field label={t('field.owner')}>
          <PersonPick people={boot.people} value={d.owner_id} onChange={(id) => set('owner_id', id)} testId="sales-form-owner" />
        </Field>
        <Field label={t('field.currency')}>
          <Select value={d.currency} onChange={(v) => set('currency', v)}>
            <option value="">—</option>
            {f.currencyOptions(record?.currency).map((c) => <option key={c.code} value={c.code}>{f.currencyLabel(c.code)}</option>)}
          </Select>
        </Field>
        {bid ? (
          <>
            <Field label={t('field.source')}>
              <Select value={d.source} onChange={(v) => set('source', v)}>
                <option value="">—</option>
                <option value="website">{t('source.website')}</option>
                <option value="email">{t('source.email')}</option>
                <option value="other">{t('source.other')}</option>
              </Select>
            </Field>
            <Field label={t('field.received_on')}>
              <DateInput value={d.received_on} onChange={(v) => set('received_on', v)} />
            </Field>
          </>
        ) : (
          <Field label={t('field.project_site')}>
            <Input maxLength={200} value={d.project_site} onChange={(e) => set('project_site', e.target.value)} />
          </Field>
        )}
        <Field label={t('field.description')} className="sm:col-span-2">
          <Textarea rows={2} maxLength={4000} value={d.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
      </div>

      {bid ? (
        <fieldset className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <legend className="sr-only">{t('form.bidBlock')}</legend>
          <Field label={t('field.proposal_due')}>
            <DateInput value={d.proposal_due} onChange={(v) => set('proposal_due', v)} testId="sales-form-proposal-due" />
          </Field>
          {boot.caps.prices_edit ? (
            <Field label={t('field.our_price')} hint={pricedByItems ? t('form.pricedByItems') : undefined}>
              <NumberInput value={d.our_price} onChange={(n) => set('our_price', n)} disabled={pricedByItems} />
            </Field>
          ) : <span className="hidden sm:block" />}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={d.needs_quote} onChange={(e) => set('needs_quote', e.target.checked)} />
            {t('field.needs_quote')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={d.needs_bond} onChange={(e) => set('needs_bond', e.target.checked)} />
            {t('field.needs_bond')}
          </label>
          {d.needs_quote ? (
            <Field label={t('field.quote_due')}>
              <DateInput value={d.quote_due} onChange={(v) => set('quote_due', v)} />
            </Field>
          ) : null}
          {d.needs_bond ? (
            <Field label={t('field.bond_due')}>
              <DateInput value={d.bond_due} onChange={(v) => set('bond_due', v)} />
            </Field>
          ) : null}
        </fieldset>
      ) : (
        <fieldset className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <legend className="sr-only">{t('form.contractBlock')}</legend>
          <Field label={t('field.order_date')}>
            <DateInput value={d.order_date} onChange={(v) => set('order_date', v)} />
          </Field>
          <Field label={t('field.contract_start')}>
            <DateInput value={d.contract_start} onChange={(v) => set('contract_start', v)} />
          </Field>
          <Field label={t('field.delivery_duration')} hint={d.delivery_text ? t('form.deliveryText', { text: d.delivery_text }) : undefined}>
            <div className="flex gap-2">
              <NumberInput value={d.delivery_amount} onChange={(n) => set('delivery_amount', n)} ariaLabel={t('field.delivery_duration')} />
              <Select value={d.delivery_unit} onChange={(v) => set('delivery_unit', v)} ariaLabel={t('field.delivery_unit')}>
                <option value="">—</option>
                <option value="day">{t('unit.day')}</option>
                <option value="week">{t('unit.week')}</option>
                <option value="month">{t('unit.month')}</option>
              </Select>
            </div>
          </Field>
          <Field label={t('field.delivery_date')}>
            <DateInput value={d.delivery_date} onChange={(v) => set('delivery_date', v)} />
          </Field>
          <Field label={t('field.prepayment')}>
            <Select value={d.prepayment} onChange={(v) => set('prepayment', v)}>
              <option value="">—</option>
              <option value="yes">{t('yes')}</option>
              <option value="no">{t('no')}</option>
            </Select>
          </Field>
          <Field label={t('field.prepayment_date')}>
            <DateInput value={d.prepayment_date} onChange={(v) => set('prepayment_date', v)} />
          </Field>
          <Field label={t('field.addendum')}>
            <Select value={d.addendum} onChange={(v) => set('addendum', v)}>
              <option value="">—</option>
              <option value="yes">{t('yes')}</option>
              <option value="no">{t('no')}</option>
            </Select>
          </Field>
          {boot.caps.prices_edit ? (
            <Field label={t('field.total_value')}>
              <NumberInput value={d.total_value} onChange={(n) => set('total_value', n)} />
            </Field>
          ) : null}
        </fieldset>
      )}

      {fields.length > 0 ? (
        <fieldset className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <legend className="sr-only">{t('form.extraBlock')}</legend>
          {fields.map((def) => (
            <Field key={def.key} label={f.fieldLabel(def)}>
              <CustomFieldInput
                def={def}
                value={d.custom[def.key]}
                onChange={(v) => setD((prev) => {
                  const custom = { ...prev.custom };
                  if (v === null) delete custom[def.key];
                  else custom[def.key] = v;
                  return { ...prev, custom };
                })}
              />
            </Field>
          ))}
        </fieldset>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" className="max-sm:h-11" onClick={onCancel} disabled={pending}>{t('cancel')}</Button>
        <Button pending={pending} type="submit" className="max-sm:h-11" disabled={pending || !d.title.trim()} data-testid="sales-form-save">
          {record ? t('save') : t('form.create')}
        </Button>
      </div>
    </form>
  );
}
