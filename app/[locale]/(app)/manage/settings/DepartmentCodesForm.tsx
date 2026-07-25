'use client';

import { useState, useTransition } from 'react';
import { updateDepartmentCode } from '@/lib/actions/departments';
import { isValidDepartmentCode, normalizeDepartmentCode } from '@/lib/departments/code';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type Department = { id: string; name_fa: string; name_en: string; code: string };

type Props = {
  departments: Department[];
  locale: string;
  labels: {
    title: string;
    hint: string;
    save: string;
    saved: string;
    invalid: string;
    errorLabel: string;
  };
};

/**
 * Admin editor for department codes — the latin prefix of generated
 * employee codes (e.g. prod-1042). Existing accounts keep their codes.
 */
export function DepartmentCodesForm({ departments, locale, labels }: Props) {
  const [codes, setCodes] = useState<Record<string, string>>(
    Object.fromEntries(departments.map((d) => [d.id, d.code]))
  );
  const [status, setStatus] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const save = (id: string) => {
    const value = normalizeDepartmentCode(codes[id] ?? '');
    if (!isValidDepartmentCode(value)) {
      setStatus((s) => ({ ...s, [id]: labels.invalid }));
      return;
    }
    startTransition(async () => {
      const res = await updateDepartmentCode(id, value);
      setStatus((s) => ({
        ...s,
        [id]: res.ok ? labels.saved : `${labels.errorLabel}: ${res.error}`,
      }));
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{labels.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{labels.hint}</p>
      </div>
      <div className="space-y-3">
        {departments.map((d) => (
          <div key={d.id} className="flex items-center gap-3">
            <span className="flex-1 text-sm">
              {locale === 'fa' ? d.name_fa : d.name_en}
            </span>
            <Input
              value={codes[d.id] ?? ''}
              onChange={(e) => setCodes((c) => ({ ...c, [d.id]: e.target.value }))}
              dir="ltr"
              autoCapitalize="off"
              autoCorrect="off"
              maxLength={6}
              className="w-28 font-mono"
              data-testid={`dept-code-input-${d.name_en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending || (codes[d.id] ?? '') === d.code}
              onClick={() => save(d.id)}
            >
              {labels.save}
            </Button>
            {status[d.id] && (
              <span className="text-xs text-muted-foreground">{status[d.id]}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
