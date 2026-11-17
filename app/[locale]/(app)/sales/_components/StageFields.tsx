'use client';

/**
 * Sales stage pages: one input (or one read-only value) per record field key, so each
 * stage page lists its keys and this file draws them. Values are the API's own shape
 * (dates as `YYYY-MM-DD`, empty = null), so the draft goes to the database unchanged.
 */

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { canEditKey } from '@/lib/sales/stagePages';
import { CURRENCIES, type Bootstrap, type CustomValues, type RecordRow } from '@/lib/sales/types';
import { cn } from '@/lib/utils';
import { CustomFieldInput, DateInput, Field, NumberInput, PersonPick, Select, useSalesFormat } from './parts';

export type Draft = Record<string, unknown>;

const PRICE_KEYS = new Set(['our_price', 'winning_bid', 'winner_name', 'total_value']);
const DATE_KEYS = new Set(['received_on', 'proposal_due', 'quote_due', 'bond_due', 'submitted_on', 'order_date',
  'contract_start', 'delivery_date', 'prepayment_date']);
const WIDE_KEYS = new Set(['title', 'description', 'decision_reason', 'result_reason']);
/** Drawn inside another field (delivery amount + unit), or only when a switch is on. */
const SKIP_KEYS = new Set(['delivery_unit', 'delivery_text']);

/** The `sales.field.*` label of a record key. */
export function labelKey(key: string): string {
  if (key === 'owner_id') return 'owner';
  if (key === 'delivery_amount') return 'delivery_duration';
  return key;
}

/** Whether a key is shown at all to this caller (price keys need `sales_prices`). */
export function visibleKey(key: string, boot: Bootstrap): boolean {
  if (SKIP_KEYS.has(key)) return false;
  return !PRICE_KEYS.has(key) || boot.caps.prices;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const orNull = (v: string) => (v.trim() === '' ? null : v);
const tri = (v: unknown) => (v === true ? 'yes' : v === false ? 'no' : '');
const fromTri = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null);

export function StageFieldGrid({ keys, boot, record, draft, onChange, editable, pricedByItems }: {
  keys: string[]; boot: Bootstrap; record: RecordRow; draft: Draft; onChange: (next: Draft) => void;
  editable: boolean; pricedByItems: boolean;
}) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const shown = keys.filter((k) => visibleKey(k, boot)
    && !(k === 'quote_due' && !(draft.needs_quote ?? record.needs_quote))
    && !(k === 'bond_due' && !(draft.needs_bond ?? record.needs_bond)));
  if (shown.length === 0) return null;

  return (
    <dl className={cn('grid gap-x-6', editable ? 'gap-y-4 sm:grid-cols-2' : 'divide-y divide-border sm:grid-cols-2 sm:divide-y-0')}>
      {shown.map((key) => {
        const custom = key.startsWith('custom.') ? boot.fields.find((d) => d.entity === 'rfp' && d.key === key.slice(7)) : null;
        const label = custom ? f.fieldLabel(custom) : t(`field.${labelKey(key)}` as 'field.title');
        const wide = WIDE_KEYS.has(key);
        const canEdit = editable && canEditKey(key, boot.caps, record, pricedByItems);
        if (!canEdit) {
          return (
            <div key={key} className={cn('flex flex-col gap-0.5 py-2', wide && 'sm:col-span-2')} data-testid={`sales-field-${key}`}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm break-words whitespace-pre-wrap">
                <FieldText fieldKey={key} boot={boot} record={record} value={key.startsWith('custom.') ? (draft.custom as CustomValues | undefined)?.[key.slice(7)] : draft[key]} />
              </dd>
            </div>
          );
        }
        return (
          <Field key={key} label={label} className={cn(wide && 'sm:col-span-2')}
            hint={key === 'our_price' && pricedByItems ? t('stagePage.pricedByItems') : key === 'delivery_amount' && record.delivery_text ? t('form.deliveryText', { text: record.delivery_text }) : undefined}>
            <FieldInput fieldKey={key} boot={boot} record={record} draft={draft} onChange={onChange} />
          </Field>
        );
      })}
    </dl>
  );
}

function FieldInput({ fieldKey: key, boot, record, draft, onChange }: {
  fieldKey: string; boot: Bootstrap; record: RecordRow; draft: Draft; onChange: (next: Draft) => void;
}) {
  const t = useTranslations('sales');
  const set = (k: string, v: unknown) => onChange({ ...draft, [k]: v });
  const testId = `sales-input-${key}`;
  const v = draft[key];

  if (key.startsWith('custom.')) {
    const def = boot.fields.find((d) => d.entity === 'rfp' && d.key === key.slice(7));
    if (!def) return null;
    const values = (draft.custom ?? {}) as CustomValues;
    return (
      <CustomFieldInput def={def} value={values[def.key]} onChange={(nv) => {
        const custom = { ...values };
        if (nv === null) delete custom[def.key]; else custom[def.key] = nv;
        onChange({ ...draft, custom });
      }} />
    );
  }
  if (DATE_KEYS.has(key)) return <DateInput value={(v as string | null) ?? null} onChange={(d) => set(key, d)} testId={testId} />;
  switch (key) {
    case 'description': case 'decision_reason': case 'result_reason':
      return <Textarea rows={2} maxLength={key === 'description' ? 4000 : 2000} value={str(v)} onChange={(e) => set(key, orNull(e.target.value))} data-testid={testId} />;
    case 'owner_id':
      return <PersonPick people={boot.people} value={(v as string | null) ?? null} onChange={(id) => set(key, id)} testId={testId} />;
    case 'buyer': case 'client':
      return <Input list="sales-customers" maxLength={200} value={str(v)} onChange={(e) => set(key, e.target.value)} data-testid={testId} />;
    case 'buyer_kind':
      return (
        <Select value={str(v)} onChange={(x) => set(key, orNull(x))} testId={testId}>
          <option value="">—</option>
          <option value="government">{t('customerKind.government')}</option>
          <option value="contractor">{t('customerKind.contractor')}</option>
        </Select>
      );
    case 'source':
      return (
        <Select value={str(v)} onChange={(x) => set(key, orNull(x))} testId={testId}>
          <option value="">—</option>
          {(['website', 'email', 'other'] as const).map((s) => <option key={s} value={s}>{t(`source.${s}`)}</option>)}
        </Select>
      );
    case 'currency':
      return (
        <Select value={str(v)} onChange={(x) => set(key, orNull(x))} testId={testId}>
          <option value="">—</option>
          {CURRENCIES.map((c) => <option key={c} value={c}>{t(`currency.${c}`)}</option>)}
        </Select>
      );
    case 'delivery_method':
      return (
        <Select value={str(v)} onChange={(x) => set(key, orNull(x))} testId={testId}>
          <option value="">—</option>
          <option value="hand">{t('delivery.hand')}</option>
          <option value="courier">{t('delivery.courier')}</option>
        </Select>
      );
    case 'needs_quote': case 'needs_bond':
      return (
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={v === true} onChange={(e) => set(key, e.target.checked)} data-testid={testId} />
          {t('yes')}
        </label>
      );
    case 'prepayment': case 'addendum':
      return (
        <Select value={tri(v)} onChange={(x) => set(key, fromTri(x))} testId={testId}>
          <option value="">—</option>
          <option value="yes">{t('yes')}</option>
          <option value="no">{t('no')}</option>
        </Select>
      );
    case 'delivery_amount':
      return (
        <div className="flex gap-2">
          <NumberInput value={(v as number | null) ?? null} onChange={(n) => set(key, n)} ariaLabel={t('field.delivery_duration')} testId={testId} />
          <Select value={str(draft.delivery_unit ?? record.delivery_unit)} onChange={(x) => set('delivery_unit', orNull(x))} ariaLabel={t('field.delivery_unit')}>
            <option value="">—</option>
            {(['day', 'week', 'month'] as const).map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
          </Select>
        </div>
      );
    case 'our_price': case 'winning_bid': case 'total_value': case 'validity_days': case 'revision':
      return <NumberInput value={(v as number | null) ?? null} onChange={(n) => set(key, n)} testId={testId} />;
    case 'title':
      return <Input required maxLength={300} value={str(v)} onChange={(e) => set(key, e.target.value)} data-testid={testId} />;
    default:
      return <Input maxLength={200} value={str(v)} onChange={(e) => set(key, orNull(e.target.value))} data-testid={testId} />;
  }
}

/** One record value as text. */
export function FieldText({ fieldKey: key, boot, record, value }: {
  fieldKey: string; boot: Bootstrap; record: RecordRow; value: unknown;
}): React.ReactNode {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  if (key.startsWith('custom.')) {
    const def = boot.fields.find((d) => d.entity === 'rfp' && d.key === key.slice(7));
    return def ? f.custom(def, value as CustomValues[string] | undefined) : '—';
  }
  if (value === null || value === undefined || value === '') return '—';
  if (DATE_KEYS.has(key)) return f.date(String(value));
  if (typeof value === 'boolean') return value ? t('yes') : t('no');
  switch (key) {
    case 'owner_id': return boot.people.find((p) => p.id === value)?.name ?? record.owner_name ?? '—';
    case 'buyer_kind': return t(`customerKind.${value as 'government'}`);
    case 'source': return t(`source.${value as 'email'}`);
    case 'currency': return t(`currency.${value as 'IRR'}`);
    case 'delivery_method': return t(`delivery.${value as 'hand'}`);
    case 'our_price': case 'winning_bid': case 'total_value': return f.money(value as number, record.currency);
    case 'validity_days': return t('daysCount', { days: value as number });
    case 'delivery_amount': return `${f.number(value as number)}${record.delivery_unit ? ` ${t(`unit.${record.delivery_unit}`)}` : ''}`;
    default: return typeof value === 'number' ? f.number(value) : String(value);
  }
}
