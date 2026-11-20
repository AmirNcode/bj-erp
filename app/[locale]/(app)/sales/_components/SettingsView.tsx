'use client';

/**
 * FR-94 Settings › Sales: what bends without a rebuild — the stages of each
 * flow, the extra columns of records and items, numbering and reminders'
 * windows, the document template — and the contract ledger import.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { deleteSalesCurrency, orderSalesStages, saveSalesCurrency, saveSalesField, saveSalesSettings, saveSalesStage } from '@/lib/actions/sales';
import { tabClass, tabListClass } from '@/lib/ui/tabs';
import type { Bootstrap, Currency, RecordNumbers, FieldDef, FieldType, Flow, Stage, StageKind } from '@/lib/sales/types';
import { ConfirmDialog, Field, NumberInput, Select, Tag, useRun, useSalesFormat } from './parts';
import { ImportPanel } from './ImportPanel';

type Section = 'stages' | 'fields' | 'currencies' | 'general' | 'import';

export function SettingsView({ boot, numbers }: { boot: Bootstrap; numbers: RecordNumbers }) {
  const t = useTranslations('sales.settings');
  const [section, setSection] = useState<Section>('stages');
  return (
    <div className="flex flex-col gap-5" data-testid="sales-settings">
      <nav className={tabListClass} aria-label={t('label')}>
        {(['stages', 'fields', 'currencies', 'general', 'import'] as const).map((key) => (
          <button key={key} type="button" className={tabClass(section === key)} aria-current={section === key ? 'page' : undefined}
            onClick={() => setSection(key)} data-testid={`sales-settings-${key}`}>
            {t(`section.${key}`)}
          </button>
        ))}
      </nav>
      {section === 'stages' ? <StagesEditor boot={boot} /> : null}
      {section === 'fields' ? <FieldsEditor boot={boot} /> : null}
      {section === 'currencies' ? <CurrenciesEditor boot={boot} /> : null}
      {section === 'general' ? <GeneralSettings boot={boot} /> : null}
      {section === 'import' ? <ImportPanel boot={boot} numbers={numbers} /> : null}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── stages

const STAGE_KINDS: StageKind[] = ['open', 'done', 'lost', 'no_bid', 'cancelled'];

function StagesEditor({ boot }: { boot: Bootstrap }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [editing, setEditing] = useState<{ flow: Flow; stage: Stage | null } | null>(null);
  const roleName = (id: string | null) => boot.roles.find((r) => r.id === id)?.name ?? '—';

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('settings.stagesIntro')}</p>
      {boot.flows.map((flow) => {
        const stages = boot.stages.filter((s) => s.flow_id === flow.id).sort((a, b) => a.position - b.position);
        const move = (index: number, by: number) => {
          const ids = stages.map((s) => s.id);
          [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
          return run(() => orderSalesStages(flow.id, ids));
        };
        return (
          <section key={flow.id} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t(`flow.${flow.kind}`)}</h3>
              <Button size="sm" variant="outline" onClick={() => setEditing({ flow, stage: null })} data-testid={`sales-stage-add-${flow.kind}`}>
                <Plus aria-hidden="true" /> {t('settings.addStage')}
              </Button>
            </div>
            <div className="overflow-x-auto border-b border-border">
              <table className="data-table w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-start">{t('settings.order')}</th>
                    <th className="text-start">{t('settings.stageName')}</th>
                    <th className="text-start">{t('settings.stageKind')}</th>
                    <th className="text-start">{t('settings.stageAction')}</th>
                    <th className="text-start">{t('settings.ownerRole')}</th>
                    <th className="text-start">{t('settings.required')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stages.map((s, i) => (
                    <tr key={s.id} className={s.active ? 'whitespace-nowrap' : 'whitespace-nowrap text-muted-foreground'}>
                      <td>
                        <Button size="icon-sm" variant="ghost" disabled={pending || i === 0} aria-label={t('settings.moveUp')} onClick={() => void move(i, -1)}><ArrowUp /></Button>
                        <Button size="icon-sm" variant="ghost" disabled={pending || i === stages.length - 1} aria-label={t('settings.moveDown')} onClick={() => void move(i, 1)}><ArrowDown /></Button>
                      </td>
                      <td className="font-medium">{f.stageName(s)}{!s.active ? <> <Tag>{t('settings.retired')}</Tag></> : null}</td>
                      <td>{t(`stageKind.${s.kind}`)}</td>
                      <td>{s.action ? t(`stageAction.${s.action}`) : '—'}</td>
                      <td>{roleName(s.owner_role_id)}</td>
                      <td>{s.required.length ? f.number(s.required.length) : '—'}</td>
                      <td className="text-end"><Button size="xs" variant="ghost" onClick={() => setEditing({ flow, stage: s })}>{t('action.edit')}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {editing ? <StageDialog boot={boot} flow={editing.flow} stage={editing.stage} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/** Record columns a stage may require, beyond the custom fields. */
const REQUIRABLE = ['buyer_id', 'client_id', 'customer_ref', 'description', 'currency', 'proposal_due', 'our_price', 'total_value', 'delivery_date', 'contract_start'] as const;
const REQUIRED_LABEL: Record<(typeof REQUIRABLE)[number], string> = {
  buyer_id: 'buyer', client_id: 'client', customer_ref: 'customer_ref', description: 'description', currency: 'currency',
  proposal_due: 'proposal_due', our_price: 'our_price', total_value: 'total_value', delivery_date: 'delivery_date', contract_start: 'contract_start',
};

function StageDialog({ boot, flow, stage, onClose }: { boot: Bootstrap; flow: Flow; stage: Stage | null; onClose: () => void }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [nameFa, setNameFa] = useState(stage?.name_fa ?? '');
  const [nameEn, setNameEn] = useState(stage?.name_en ?? '');
  const [kind, setKind] = useState<StageKind>(stage?.kind ?? 'open');
  const [action, setAction] = useState<string>(stage?.action ?? '');
  const [role, setRole] = useState<string>(stage?.owner_role_id ?? '');
  const [required, setRequired] = useState<string[]>(stage?.required ?? []);
  const [active, setActive] = useState(stage?.active ?? true);
  const kinds = STAGE_KINDS.filter((k) => (flow.kind === 'bid' ? k !== 'done' : k !== 'lost' && k !== 'no_bid'));
  const options = [
    ...REQUIRABLE.map((k) => ({ key: k as string, label: t(`field.${REQUIRED_LABEL[k]}`) })),
    ...boot.fields.filter((d) => d.entity === 'rfp' && d.active).map((d) => ({ key: d.key, label: f.fieldLabel(d) })),
  ];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{stage ? t('settings.editStage') : t('settings.addStage')}</DialogTitle>
          <DialogDescription>{t('settings.stageDialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.labelFa')}><Input maxLength={80} value={nameFa} onChange={(e) => setNameFa(e.target.value)} data-testid="sales-stage-name-fa" /></Field>
          <Field label={t('settings.labelEn')}><Input dir="ltr" maxLength={80} value={nameEn} onChange={(e) => setNameEn(e.target.value)} /></Field>
          <Field label={t('settings.stageKind')} hint={t('settings.stageKindHint')}>
            <Select value={kind} onChange={(v) => { setKind(v as StageKind); if (v !== 'open') setAction(''); }}>
              {kinds.map((k) => <option key={k} value={k}>{t(`stageKind.${k}`)}</option>)}
            </Select>
          </Field>
          {flow.kind === 'bid' && kind === 'open' ? (
            <Field label={t('settings.stageAction')} hint={t('settings.stageActionHint')}>
              <Select value={action} onChange={setAction}>
                <option value="">{t('stageAction.none')}</option>
                {(['decide', 'quote', 'submit'] as const).map((k) => <option key={k} value={k}>{t(`stageAction.${k}`)}</option>)}
              </Select>
            </Field>
          ) : <span className="hidden sm:block" />}
          <Field label={t('settings.ownerRole')} hint={t('settings.ownerRoleHint')}>
            <Select value={role} onChange={setRole}>
              <option value="">—</option>
              {boot.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('settings.stageActive')}
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm font-medium">{t('settings.required')}</legend>
            <p className="mb-2 text-xs text-muted-foreground">{t('settings.requiredHint')}</p>
            <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-3">
              {options.map((o) => (
                <label key={o.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4" checked={required.includes(o.key)}
                    onChange={(e) => setRequired(e.target.checked ? [...required, o.key] : required.filter((k) => k !== o.key))} />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button disabled={pending || !(nameFa.trim() || nameEn.trim())} data-testid="sales-stage-save"
            onClick={() => void run(() => saveSalesStage(stage?.id ?? null, flow.id, {
              name_fa: nameFa, name_en: nameEn, kind, action: action || '', owner_role_id: role || null, required, active,
            }), onClose)}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────── extra fields

const FIELD_TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'yes_no'];

function FieldsEditor({ boot }: { boot: Bootstrap }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const [editing, setEditing] = useState<{ entity: 'rfp' | 'item'; def: FieldDef | null } | null>(null);
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('settings.fieldsIntro')}</p>
      {(['rfp', 'item'] as const).map((entity) => {
        const defs = boot.fields.filter((d) => d.entity === entity);
        return (
          <section key={entity} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t(`settings.fieldsOf.${entity}`)}</h3>
              <Button size="sm" variant="outline" onClick={() => setEditing({ entity, def: null })} data-testid={`sales-field-add-${entity}`}>
                <Plus aria-hidden="true" /> {t('settings.addField')}
              </Button>
            </div>
            {defs.length === 0 ? <p className="py-3 text-sm text-muted-foreground">{t('settings.noFields')}</p> : (
              <div className="max-w-3xl overflow-x-auto border-b border-border">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-start">{t('settings.fieldName')}</th>
                      <th className="text-start">{t('settings.fieldType')}</th>
                      {entity === 'rfp' ? <th className="text-start">{t('settings.showInList')}</th> : null}
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {defs.map((d) => (
                      <tr key={d.id} className={d.active ? 'whitespace-nowrap' : 'whitespace-nowrap text-muted-foreground'}>
                        <td className="font-medium">{f.fieldLabel(d)}{!d.active ? <> <Tag>{t('settings.retired')}</Tag></> : null}</td>
                        <td>{t(`fieldType.${d.type}`)}</td>
                        {entity === 'rfp' ? <td>{d.show_in_list ? t('yes') : t('no')}</td> : null}
                        <td className="text-end"><Button size="xs" variant="ghost" onClick={() => setEditing({ entity, def: d })}>{t('action.edit')}</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {editing ? <FieldDialog entity={editing.entity} def={editing.def} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function FieldDialog({ entity, def, onClose }: { entity: 'rfp' | 'item'; def: FieldDef | null; onClose: () => void }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [labelFa, setLabelFa] = useState(def?.label_fa ?? '');
  const [labelEn, setLabelEn] = useState(def?.label_en ?? '');
  const [type, setType] = useState<FieldType>(def?.type ?? 'text');
  const [options, setOptions] = useState((def?.options ?? []).join('\n'));
  const [showInList, setShowInList] = useState(def?.show_in_list ?? false);
  const [active, setActive] = useState(def?.active ?? true);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{def ? t('settings.editField') : t('settings.addField')}</DialogTitle>
          <DialogDescription>{t('settings.fieldDialogHint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('settings.labelFa')}><Input maxLength={80} value={labelFa} onChange={(e) => setLabelFa(e.target.value)} data-testid="sales-field-label-fa" /></Field>
          <Field label={t('settings.labelEn')}><Input dir="ltr" maxLength={80} value={labelEn} onChange={(e) => setLabelEn(e.target.value)} /></Field>
          <Field label={t('settings.fieldType')} hint={def ? t('settings.typeFixed') : undefined}>
            <Select value={type} onChange={(v) => setType(v as FieldType)} disabled={!!def}>
              {FIELD_TYPES.map((k) => <option key={k} value={k}>{t(`fieldType.${k}`)}</option>)}
            </Select>
          </Field>
          {type === 'select' ? (
            <Field label={t('settings.options')} hint={t('settings.optionsHint')} className="sm:col-span-2">
              <Textarea rows={4} value={options} onChange={(e) => setOptions(e.target.value)} />
            </Field>
          ) : null}
          {entity === 'rfp' ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4" checked={showInList} onChange={(e) => setShowInList(e.target.checked)} />
              {t('settings.showInList')}
            </label>
          ) : null}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t('settings.fieldActive')}
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('settings.fieldPriceWarning')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
          <Button disabled={pending || !(labelFa.trim() || labelEn.trim())} data-testid="sales-field-save"
            onClick={() => void run(() => saveSalesField(def?.id ?? null, {
              entity, label_fa: labelFa, label_en: labelEn, type, show_in_list: showInList, active,
              options: options.split('\n').map((o) => o.trim()).filter(Boolean),
            }), onClose)}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────── currencies

function CurrenciesEditor({ boot }: { boot: Bootstrap }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const { run, pending } = useRun();
  const [editing, setEditing] = useState<{ currency: Currency | null } | null>(null);
  const can = boot.caps.settings;
  const list = [...boot.currencies].sort((a, b) => a.position - b.position || a.code.localeCompare(b.code));
  const move = (index: number, by: number) => {
    const next = [...list];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    // Renumber 1..n so equal or zero positions cannot leave the order ambiguous.
    return run(async () => {
      for (const [i, c] of next.entries()) {
        if (c.position === i + 1) continue;
        const done = await saveSalesCurrency(c.code, { position: i + 1 });
        if (!done.ok) return done;
      }
      return { ok: true };
    });
  };
  const toggle = (c: Currency) => run(() => saveSalesCurrency(c.code, { active: !c.active }));
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('settings.currencies.intro')}</p>
      {can ? (
        <div>
          <Button size="sm" variant="outline" onClick={() => setEditing({ currency: null })} data-testid="sales-currency-add">
            <Plus aria-hidden="true" /> {t('settings.currencies.add')}
          </Button>
        </div>
      ) : <p className="text-sm text-muted-foreground">{t('settings.currencies.readOnly')}</p>}
      <div className="max-w-4xl overflow-x-auto border-b border-border">
        <table className="data-table w-full text-sm" data-testid="sales-currencies">
          <thead>
            <tr>
              {can ? <th className="text-start">{t('settings.order')}</th> : null}
              <th className="text-start">{t('settings.currencies.code')}</th>
              <th className="text-start">{t('settings.currencies.nameFa')}</th>
              <th className="text-start">{t('settings.currencies.nameEn')}</th>
              <th className="text-start">{t('settings.currencies.symbol')}</th>
              <th className="text-start">{t('settings.currencies.decimals')}</th>
              <th className="text-start">{t('settings.currencies.active')}</th>
              {can ? <th /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {list.map((c, i) => (
              <tr key={c.code} className={c.active ? 'whitespace-nowrap' : 'whitespace-nowrap text-muted-foreground'} data-testid={`sales-currency-${c.code}`}>
                {can ? (
                  <td>
                    <Button size="icon-sm" variant="ghost" disabled={pending || i === 0} aria-label={t('settings.moveUp')} onClick={() => void move(i, -1)}><ArrowUp /></Button>
                    <Button size="icon-sm" variant="ghost" disabled={pending || i === list.length - 1} aria-label={t('settings.moveDown')} onClick={() => void move(i, 1)}><ArrowDown /></Button>
                  </td>
                ) : null}
                <td className="font-medium" dir="ltr">{c.code}</td>
                <td>{c.name_fa}</td>
                <td dir="ltr">{c.name_en}</td>
                <td>{c.symbol ?? '—'}</td>
                <td>{f.number(c.decimals)}</td>
                <td>
                  {can ? (
                    <input type="checkbox" className="size-4" checked={c.active} disabled={pending} onChange={() => void toggle(c)}
                      aria-label={`${t('settings.currencies.active')}: ${c.code}`} />
                  ) : (c.active ? t('yes') : t('no'))}
                </td>
                {can ? <td className="text-end"><Button size="xs" variant="ghost" onClick={() => setEditing({ currency: c })}>{t('action.edit')}</Button></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? <CurrencyDialog currency={editing.currency} count={list.length} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function CurrencyDialog({ currency, count, onClose }: { currency: Currency | null; count: number; onClose: () => void }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [code, setCode] = useState(currency?.code ?? '');
  const [nameFa, setNameFa] = useState(currency?.name_fa ?? '');
  const [nameEn, setNameEn] = useState(currency?.name_en ?? '');
  const [symbol, setSymbol] = useState(currency?.symbol ?? '');
  const [decimals, setDecimals] = useState(String(currency?.decimals ?? 0));
  const [active, setActive] = useState(currency?.active ?? true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const valid = /^[A-Za-z0-9]{1,10}$/.test(code) && nameFa.trim() !== '' && nameEn.trim() !== '';
  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{currency ? t('settings.currencies.edit') : t('settings.currencies.add')}</DialogTitle>
            <DialogDescription>{t('settings.currencies.dialogHint')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('settings.currencies.code')} hint={currency ? undefined : t('settings.currencies.codeHint')}>
              <Input dir="ltr" maxLength={10} value={code} readOnly={!!currency} disabled={!!currency}
                onChange={(e) => setCode(e.target.value.trim())} data-testid="sales-currency-code" />
            </Field>
            <Field label={t('settings.currencies.decimals')}>
              <Select value={decimals} onChange={setDecimals}>
                {['0', '1', '2'].map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
            </Field>
            <Field label={t('settings.currencies.nameFa')}><Input maxLength={40} value={nameFa} onChange={(e) => setNameFa(e.target.value)} data-testid="sales-currency-name-fa" /></Field>
            <Field label={t('settings.currencies.nameEn')}><Input dir="ltr" maxLength={40} value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-testid="sales-currency-name-en" /></Field>
            <Field label={t('settings.currencies.symbol')}><Input maxLength={6} value={symbol} onChange={(e) => setSymbol(e.target.value)} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
              {t('settings.currencies.active')}
            </label>
          </div>
          <DialogFooter>
            {currency ? (
              <Button variant="outline" className="sm:me-auto" disabled={pending} onClick={() => setConfirmDelete(true)}>{t('settings.currencies.delete')}</Button>
            ) : null}
            <Button variant="outline" onClick={onClose} disabled={pending}>{t('cancel')}</Button>
            <Button disabled={pending || !valid} data-testid="sales-currency-save"
              onClick={() => void run(() => saveSalesCurrency(code, {
                name_fa: nameFa.trim(), name_en: nameEn.trim(), symbol: symbol.trim() || null, decimals: Number(decimals), active,
                ...(currency ? {} : { position: count + 1 }),
              }), onClose)}>
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmDelete && currency ? (
        <ConfirmDialog title={t('settings.currencies.deleteTitle')} body={t('settings.currencies.deleteBody')}
          confirmLabel={t('settings.currencies.delete')} cancelLabel={t('cancel')} pending={pending}
          onConfirm={() => void run(() => deleteSalesCurrency(currency.code), onClose)} onClose={() => setConfirmDelete(false)} />
      ) : null}
    </>
  );
}

// ───────────────────────────────────────────────────────────── general

function GeneralSettings({ boot }: { boot: Bootstrap }) {
  const t = useTranslations('sales');
  const { run, pending } = useRun();
  const [nextNo, setNextNo] = useState<number | null>(boot.settings.next_record_no);
  const [warnDays, setWarnDays] = useState<number | null>(boot.settings.warn_days);
  const [validity, setValidity] = useState<number | null>(boot.settings.validity_days);
  const [template, setTemplate] = useState(boot.settings.doc_template.join('\n'));
  return (
    <form className="flex max-w-2xl flex-col gap-5" onSubmit={(e) => {
      e.preventDefault();
      const patch: Record<string, unknown> = {
        warn_days: warnDays, validity_days: validity, doc_template: template.split('\n').map((x) => x.trim()).filter(Boolean),
      };
      if (nextNo !== boot.settings.next_record_no) patch.next_record_no = nextNo;
      void run(() => saveSalesSettings(patch));
    }}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('settings.nextRecordNo')} hint={t('settings.nextRecordNoHint')}><NumberInput value={nextNo} onChange={setNextNo} testId="sales-settings-next-no" /></Field>
        <Field label={t('settings.warnDays')} hint={t('settings.warnDaysHint')}><NumberInput value={warnDays} onChange={setWarnDays} /></Field>
        <Field label={t('settings.validityDays')} hint={t('settings.validityDaysHint')}><NumberInput value={validity} onChange={setValidity} /></Field>
      </div>
      <Field label={t('settings.docTemplate')} hint={t('settings.docTemplateHint')}>
        <Textarea rows={6} value={template} onChange={(e) => setTemplate(e.target.value)} />
      </Field>
      <div><Button type="submit" className="max-sm:h-11 max-sm:w-full" disabled={pending || nextNo === null || warnDays === null || validity === null} data-testid="sales-settings-save">{t('save')}</Button></div>
    </form>
  );
}
