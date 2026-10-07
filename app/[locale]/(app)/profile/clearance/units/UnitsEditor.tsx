'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { nativeSelectClass } from '@/lib/native-select';
import {
  saveClearanceUnits,
  type DepartmentOption,
  type PersonOption,
} from '@/lib/actions/clearance';
import type { UnitKind, UnitRow } from '@/lib/clearance/model';

type Props = {
  locale: string;
  initial: UnitRow[];
  people: PersonOption[];
  departments: DepartmentOption[];
};

const EDITABLE_KINDS: Exclude<UnitKind, 'hr'>[] = ['person', 'department', 'own_department'];

export function UnitsEditor({ locale, initial, people, departments }: Props) {
  const t = useTranslations('clearance.units');
  const tRows = useTranslations('clearance.rows');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const nextKey = useRef(0);
  const [units, setUnits] = useState<UnitRow[]>(() => {
    const sorted = [...initial].sort((a, b) => a.sortOrder - b.sortOrder);
    const hr = sorted.find((u) => u.kind === 'hr') ?? {
      id: 'new-hr',
      kind: 'hr' as const,
      nameFa: 'مدیر اداری و منابع انسانی',
      nameEn: 'HR & administration',
      departmentId: null,
      signerId: null,
      sortOrder: 0,
      active: true,
    };
    return [hr, ...sorted.filter((u) => u.kind !== 'hr')];
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const kindLabel: Record<UnitKind, string> = {
    hr: t('kinds.hr'),
    department: t('kinds.department'),
    own_department: t('kinds.own_department'),
    person: t('kinds.person'),
  };

  const update = (index: number, patch: Partial<UnitRow>) =>
    setUnits(units.map((u, i) => (i === index ? { ...u, ...patch } : u)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 1 || target >= units.length) return;
    const next = [...units];
    [next[index], next[target]] = [next[target], next[index]];
    setUnits(next);
  };

  const save = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await saveClearanceUnits(units.map((u, i) => ({ ...u, sortOrder: i })));
      if (!res.ok) {
        setMessage({ ok: false, text: res.error });
        return;
      }
      setMessage({ ok: true, text: t('saved') });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4" data-testid="clearance-units-editor">
      <ol className="space-y-3">
        {units.map((u, index) => (
          <li key={u.id} className="space-y-2 rounded-lg border border-border p-3" data-testid={`clearance-unit-${index}`}>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={u.nameFa}
                onChange={(e) => update(index, { nameFa: e.target.value })}
                aria-label={tRows('nameFa')}
                placeholder={tRows('nameFa')}
                dir="rtl"
                maxLength={100}
                data-testid={`clearance-unit-name-fa-${index}`}
              />
              <Input
                value={u.nameEn}
                onChange={(e) => update(index, { nameEn: e.target.value })}
                aria-label={tRows('nameEn')}
                placeholder={tRows('nameEn')}
                dir="ltr"
                maxLength={100}
                data-testid={`clearance-unit-name-en-${index}`}
              />
            </div>
            {u.kind === 'hr' ? (
              <p className="text-xs text-muted-foreground">{t('hrNote')}</p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t('kind')}</span>
                    <select
                      className={nativeSelectClass}
                      value={u.kind}
                      onChange={(e) =>
                        update(index, { kind: e.target.value as UnitKind, departmentId: null, signerId: null })
                      }
                      data-testid={`clearance-unit-kind-${index}`}
                    >
                      {EDITABLE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {kindLabel[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {u.kind === 'department' && (
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>{t('department')}</span>
                      <select
                        className={nativeSelectClass}
                        value={u.departmentId ?? ''}
                        onChange={(e) => update(index, { departmentId: e.target.value || null })}
                        data-testid={`clearance-unit-department-${index}`}
                      >
                        <option value="">{t('chooseDepartment')}</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {locale === 'fa' ? d.nameFa : d.nameEn}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {u.kind === 'person' && (
                    <label className="space-y-1 text-xs text-muted-foreground">
                      <span>{t('person')}</span>
                      <select
                        className={nativeSelectClass}
                        value={u.signerId ?? ''}
                        onChange={(e) => update(index, { signerId: e.target.value || null })}
                        data-testid={`clearance-unit-person-${index}`}
                      >
                        <option value="">{t('nobody')}</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.personnelNo ? ` (${p.personnelNo})` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={u.active}
                      onChange={(e) => update(index, { active: e.target.checked })}
                      className="size-4"
                    />
                    {t('active')}
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => move(index, -1)} disabled={index <= 1}>
                      {tRows('moveUp')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => move(index, 1)}
                      disabled={index >= units.length - 1}
                    >
                      {tRows('moveDown')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setUnits(units.filter((_, i) => i !== index))}
                      data-testid={`clearance-unit-remove-${index}`}
                    >
                      {tRows('remove')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setUnits([
              ...units,
              {
                id: `new-${nextKey.current++}`,
                kind: 'person',
                nameFa: '',
                nameEn: '',
                departmentId: null,
                signerId: null,
                sortOrder: units.length,
                active: true,
              },
            ])
          }
          data-testid="clearance-unit-add"
        >
          {tRows('add')}
        </Button>
        <Button type="button" onClick={save} disabled={isPending} data-testid="clearance-units-save">
          {t('save')}
        </Button>
      </div>
      {message && (
        <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
