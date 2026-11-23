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
  emptyPersonalInfo,
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
import { Card } from '@/components/ui/card';
import { FormSection } from '@/components/FormSection';
import { FIELD_W } from '@/lib/ui/fieldWidths';

type Props = {
  employeeId: string;
  initial: PersonalInfoValues;
  readOnly?: boolean;
  /** Why the form is read-only: an admin's record (hr) or one's own (FR-63). */
  readOnlyReason?: 'admin' | 'self';
};

const LTR_KINDS = new Set(['digits', 'sheba', 'date', 'count']);

/** Desktop width of a field's column (docs/DESIGN.md › Page layout and forms). */
function fieldWidth(field: PersonalInfoField) {
  switch (field.kind) {
    case 'choice':
      return FIELD_W.shortSelect;
    case 'date':
      return FIELD_W.date;
    case 'count':
      return FIELD_W.number;
    case 'sheba':
    case 'longtext':
      return FIELD_W.notes;
    default:
      return FIELD_W.name;
  }
}

export function usePersonalInfoEditor(employeeId: string, initial: PersonalInfoValues | null) {
  const t = useTranslations('personalInfo');
  const [baseline, setBaseline] = useState(() => {
    const values = initial ?? emptyPersonalInfo();
    return Object.fromEntries(PERSONAL_INFO_FIELDS.map((f) => [f.key, fieldToInput(f, values[f.key])])) as Record<PersonalInfoKey, string>;
  });
  const [text, setText] = useState(baseline);
  const [problems, setProblems] = useState<Partial<Record<PersonalInfoKey, FieldProblem>>>({});
  const set = (key: PersonalInfoKey, value: string) => {
    setText((prev) => ({ ...prev, [key]: value }));
    setProblems((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const validate = () => {
    const { problems } = parsePersonalInfoForm(text);
    setProblems(problems);
    return Object.keys(problems).length ? t('fixProblems') : null;
  };

  const save = async () => {
    const res = await savePersonalInfo(employeeId, text);
    if (!res.ok) {
      if (res.problems) setProblems(res.problems);
      return res.error;
    }
    setBaseline(text);
    return null;
  };

  const dirty = PERSONAL_INFO_FIELDS.some(({ key }) => baseline[key] !== text[key]);
  return { text, problems, set, validate, save, dirty };
}

export function PersonalInfoFields({ editor, readOnly, readOnlyReason }: {
  editor: ReturnType<typeof usePersonalInfoEditor>;
} & Pick<Props, 'readOnly' | 'readOnlyReason'>) {
  const t = useTranslations('personalInfo');
  const { text, problems, set } = editor;
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
    <div>
      {readOnly && (
        <p className="py-2 text-sm text-muted-foreground" data-testid="personal-info-read-only">
          {readOnlyReason === 'self' ? t('readOnlySelf') : t('readOnly')}
        </p>
      )}
      {PERSONAL_INFO_GROUPS.map((group) => (
        <FormSection key={group} title={t(`groups.${group}`)}>
          <Card className="p-4">
            <fieldset className="flex flex-wrap gap-x-4 gap-y-4">
              <legend className="sr-only">{t(`groups.${group}`)}</legend>
              {PERSONAL_INFO_FIELDS.filter((f) => f.group === group).map((field) => (
                <div key={field.key} className={`space-y-1.5 ${fieldWidth(field)}`}>
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
            </fieldset>
          </Card>
        </FormSection>
      ))}
    </div>
  );
}

export function PersonalInfoForm({ employeeId, initial, readOnly, readOnlyReason }: Props) {
  const editor = usePersonalInfoEditor(employeeId, initial);
  const t = useTranslations('personalInfo');
  const router = useRouter();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const error = editor.validate() ?? await editor.save();
      setStatus(error ? { ok: false, message: error } : { ok: true, message: t('saved') });
      if (!error) router.refresh();
    });
  }
  return (
    <form onSubmit={onSubmit} onChange={() => setStatus(null)} data-testid="personal-info-form" noValidate>
      <PersonalInfoFields editor={editor} readOnly={readOnly} readOnlyReason={readOnlyReason} />
      {(status || !readOnly) && (
        <div className="flex items-center justify-end gap-3 pt-4 lg:ms-[calc(20rem+2.5rem)]">
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
        </div>
      )}
    </form>
  );
}
