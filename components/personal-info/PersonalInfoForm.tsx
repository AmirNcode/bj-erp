'use client';

/**
 * Personal information form (FR-53), used on Profile (own record) and on
 * Manage › Employees › Edit (hr/admin). Every field is optional; the form shows
 * each problem beside its field, and the database checks the same rules.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { savePersonalInfo } from '@/lib/actions/personal-info';
import {
  PERSONAL_INFO_FIELDS,
  PERSONAL_INFO_GROUPS,
  fieldToInput,
  parsePersonalInfoForm,
  type FieldProblem,
  type PersonalInfoField,
  type PersonalInfoKey,
  type PersonalInfoValues,
} from '@/lib/personal-info/fields';
import { nativeSelectClass } from '@/lib/native-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

type Props = {
  employeeId: string;
  initial: PersonalInfoValues;
  readOnly?: boolean;
};

const LTR_KINDS = new Set(['digits', 'sheba', 'date', 'count']);

export function PersonalInfoForm({ employeeId, initial, readOnly = false }: Props) {
  const t = useTranslations('personalInfo');
  const router = useRouter();
  const [text, setText] = useState<Record<PersonalInfoKey, string>>(
    () =>
      Object.fromEntries(
        PERSONAL_INFO_FIELDS.map((f) => [f.key, fieldToInput(f, initial[f.key])])
      ) as Record<PersonalInfoKey, string>
  );
  const [problems, setProblems] = useState<Partial<Record<PersonalInfoKey, FieldProblem>>>({});
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const set = (key: PersonalInfoKey, value: string) => {
    setText((prev) => ({ ...prev, [key]: value }));
    setProblems((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setStatus(null);
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);
    const parsed = parsePersonalInfoForm(text);
    if (Object.keys(parsed.problems).length > 0) {
      setProblems(parsed.problems);
      setStatus({ ok: false, message: t('fixProblems') });
      return;
    }
    startTransition(async () => {
      const res = await savePersonalInfo(employeeId, text);
      if (!res.ok) {
        if (res.problems) setProblems(res.problems);
        setStatus({ ok: false, message: res.error });
        return;
      }
      setStatus({ ok: true, message: t('saved') });
      router.refresh();
    });
  };

  const input = (field: PersonalInfoField) => {
    const id = `pi-${field.key}`;
    const common = {
      id,
      value: text[field.key],
      disabled: readOnly,
      'aria-invalid': problems[field.key] ? true : undefined,
      'aria-describedby': problems[field.key] ? `${id}-problem` : `${id}-hint`,
      'data-testid': id,
    };
    if (field.kind === 'choice') {
      return (
        <select {...common} className={nativeSelectClass} onChange={(e) => set(field.key, e.target.value)}>
          <option value="">{t('choose')}</option>
          {field.choices!.map((c) => (
            <option key={c} value={c}>
              {t(`choices.${c}`)}
            </option>
          ))}
        </select>
      );
    }
    if (field.kind === 'longtext') {
      return <Textarea {...common} rows={2} maxLength={500} onChange={(e) => set(field.key, e.target.value)} />;
    }
    return (
      <Input
        {...common}
        dir={LTR_KINDS.has(field.kind) ? 'ltr' : undefined}
        inputMode={field.kind === 'digits' || field.kind === 'count' ? 'numeric' : undefined}
        autoComplete="off"
        maxLength={field.kind === 'text' ? 100 : 40}
        placeholder={field.kind === 'date' ? '1370/01/01' : undefined}
        onChange={(e) => set(field.key, e.target.value)}
      />
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" data-testid="personal-info-form" noValidate>
      {readOnly && <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}
      {PERSONAL_INFO_GROUPS.map((group) => (
        <fieldset key={group} className="space-y-3">
          <legend className="mb-2 text-sm font-semibold">{t(`groups.${group}`)}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {PERSONAL_INFO_FIELDS.filter((f) => f.group === group).map((field) => (
              <div key={field.key} className={field.kind === 'longtext' ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
                <Label htmlFor={`pi-${field.key}`}>{t(`fields.${field.key}`)}</Label>
                {input(field)}
                {problems[field.key] ? (
                  <p id={`pi-${field.key}-problem`} className="text-xs text-destructive" role="alert">
                    {t(`problems.${problems[field.key]}`)}
                  </p>
                ) : t.has(`hints.${field.key}`) ? (
                  <p id={`pi-${field.key}-hint`} className="text-xs text-muted-foreground">
                    {t(`hints.${field.key}`)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </fieldset>
      ))}

      {status && (
        <p
          role={status.ok ? 'status' : 'alert'}
          data-testid="personal-info-status"
          className={status.ok ? 'text-sm text-success' : 'text-sm text-destructive'}
        >
          {status.message}
        </p>
      )}
      {!readOnly && (
        <Button type="submit" disabled={isPending} data-testid="personal-info-save">
          {t('save')}
        </Button>
      )}
    </form>
  );
}
