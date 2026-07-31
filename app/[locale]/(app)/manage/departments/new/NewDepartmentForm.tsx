'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createDepartment } from '@/lib/actions/departments';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { nativeSelectClass } from '@/lib/native-select';

type Kind = 'team' | 'office' | 'security';

type ExistingDepartment = { id: string; name_fa: string; name_en: string };

type Props = {
  existing: ExistingDepartment[];
  locale: string;
  labels: {
    nameFa: string;
    nameEn: string;
    kind: string;
    kindTeam: string;
    kindOffice: string;
    kindSecurity: string;
    create: string;
    cancel: string;
    existingTitle: string;
    createdTitle: string;
    createdHint: string;
    addEmployee: string;
    backToSettings: string;
    nameRequired: string;
    errorLabel: string;
  };
};

/**
 * Admin-only department creator. There is no code field: since 20260730130002
 * the code prefixes nothing, so `createDepartment` derives it from the English
 * name and the admin never sees it (spec 2026-07-30 §6.1 / D12, D13).
 */
export function NewDepartmentForm({ existing, locale, labels }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ nameFa: string; nameEn: string } | null>(null);

  const [nameFa, setNameFa] = useState('');
  const [nameEn, setNameEn] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fa = nameFa.trim();
    const en = nameEn.trim();
    if (!fa || !en) {
      setError(labels.nameRequired);
      return;
    }

    setPending(true);
    const fd = new FormData(e.currentTarget);
    const result = await createDepartment({
      name_fa: fa,
      name_en: en,
      kind: (fd.get('kind') as Kind) || 'team',
    });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated({ nameFa: fa, nameEn: en });
  }

  if (created) {
    return (
      <Card className="border-2 border-success/30 bg-success-foreground">
        <CardContent className="space-y-4 pt-6" data-testid="dept-created">
          <h2 className="text-lg font-semibold text-success">{labels.createdTitle}</h2>
          <p className="text-base">{locale === 'fa' ? created.nameFa : created.nameEn}</p>
          <p className="text-sm text-success">{labels.createdHint}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <a href={`/${locale}/manage/employees/new`} data-testid="dept-add-employee">
                {labels.addEmployee}
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/${locale}/manage/settings`} data-testid="dept-back-to-settings">
                {labels.backToSettings}
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <p
                role="alert"
                data-testid="dept-error"
                className="bg-destructive/10 border border-destructive/20 text-destructive px-4 py-3 rounded-lg text-sm"
              >
                {labels.errorLabel}: {error}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="name_fa">{labels.nameFa}</Label>
              <Input
                id="name_fa"
                name="name_fa"
                data-testid="dept-name-fa"
                required
                value={nameFa}
                onChange={(e) => setNameFa(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name_en">{labels.nameEn}</Label>
              <Input
                id="name_en"
                name="name_en"
                data-testid="dept-name-en"
                required
                dir="ltr"
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
              />
            </div>

            {/* Native <select> — must stay native for Playwright selectOption e2e */}
            <div className="space-y-1.5">
              <Label htmlFor="kind">{labels.kind}</Label>
              <select id="kind" name="kind" defaultValue="team" className={nativeSelectClass}>
                <option value="team">{labels.kindTeam}</option>
                <option value="office">{labels.kindOffice}</option>
                <option value="security">{labels.kindSecurity}</option>
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={pending} data-testid="dept-submit">
                {pending ? '...' : labels.create}
              </Button>
              <Button
                type="button"
                variant="outline"
                data-testid="dept-cancel"
                onClick={() => router.push(`/${locale}/manage/settings`)}
              >
                {labels.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Names only — a code that prefixes nothing is noise here too (D13). */}
      {existing.length > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="text-base font-semibold">{labels.existingTitle}</h2>
            <ul className="space-y-1" data-testid="dept-existing">
              {existing.map((d) => (
                <li key={d.id} className="text-sm">
                  {locale === 'fa' ? d.name_fa : d.name_en}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
