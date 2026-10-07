'use client';

/**
 * The sign-off rows of one clearance form (FR-54 D3), on the new-form and the
 * edit-rows screens. The HR row is always first and locked; signed rows can only
 * move; every other row can be renamed, given a signer, moved or removed.
 */

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PersonSearch } from '@/components/PersonSearch';
import type { DraftRow } from '@/lib/clearance/model';
import type { PersonOption } from '@/lib/actions/clearance';

type Props = {
  rows: DraftRow[];
  onChange: (rows: DraftRow[]) => void;
  people: PersonOption[];
  /** The leaver, never offered as a signer. */
  leaverId: string | null;
  locale: string;
};

export function RowsEditor({ rows, onChange, people, leaverId, locale }: Props) {
  const t = useTranslations('clearance.rows');
  const tSearch = useTranslations('personSearch');
  const nextKey = useRef(0);
  const signers = people.filter((p) => p.id !== leaverId);

  const update = (key: string, patch: Partial<DraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    // Index 0 is the HR row; nothing moves above it.
    if (target < 1 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const add = () =>
    onChange([
      ...rows,
      {
        key: `new-${nextKey.current++}`,
        isHr: false,
        nameFa: '',
        nameEn: '',
        departmentId: null,
        signerId: null,
        signed: false,
      },
    ]);

  return (
    <div className="space-y-3" data-testid="clearance-rows-editor">
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <ol className="space-y-3">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className="rounded-lg border border-border p-3"
            data-testid={`clearance-row-${index}`}
            data-hr={row.isHr ? 'true' : undefined}
          >
            {row.isHr || row.signed ? (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{locale === 'fa' ? row.nameFa : row.nameEn}</span>
                <span className="text-xs text-muted-foreground">
                  {row.isHr ? `${t('anyHr')} · ${t('hrLocked')}` : t('signedLocked')}
                </span>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  value={row.nameFa}
                  onChange={(e) => update(row.key, { nameFa: e.target.value })}
                  placeholder={t('nameFa')}
                  aria-label={t('nameFa')}
                  dir="rtl"
                  maxLength={100}
                  data-testid={`clearance-row-name-fa-${index}`}
                />
                <Input
                  value={row.nameEn}
                  onChange={(e) => update(row.key, { nameEn: e.target.value })}
                  placeholder={t('nameEn')}
                  aria-label={t('nameEn')}
                  dir="ltr"
                  maxLength={100}
                  data-testid={`clearance-row-name-en-${index}`}
                />
                <div className="sm:col-span-2 space-y-1 text-xs text-muted-foreground">
                  <label htmlFor={`clearance-row-signer-${index}`}>{t('signer')}</label>
                  <PersonSearch
                    id={`clearance-row-signer-${index}`}
                    people={signers}
                    value={row.signerId}
                    onChange={(signerId) => update(row.key, { signerId })}
                    placeholder={`${t('unassigned')} · ${tSearch('placeholder')}`}
                    testId={`clearance-row-signer-${index}`}
                  />
                </div>
              </div>
            )}
            {!row.isHr && (
              <div className="mt-2 flex flex-wrap justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => move(index, -1)} disabled={index <= 1}>
                  {t('moveUp')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => move(index, 1)}
                  disabled={index >= rows.length - 1}
                >
                  {t('moveDown')}
                </Button>
                {!row.signed && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => remove(row.key)}
                    data-testid={`clearance-row-remove-${index}`}
                  >
                    {t('remove')}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" size="sm" onClick={add} data-testid="clearance-row-add">
        {t('add')}
      </Button>
    </div>
  );
}
