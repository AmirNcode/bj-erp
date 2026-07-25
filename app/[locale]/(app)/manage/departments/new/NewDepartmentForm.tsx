'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createDepartment } from '@/lib/actions/departments';
import {
  isValidDepartmentCode,
  normalizeDepartmentCode,
  suggestDepartmentCode,
} from '@/lib/departments/code';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { nativeSelectClass } from '@/lib/native-select';

type Kind = 'team' | 'office' | 'security';

type ExistingDepartment = { id: string; name_fa: string; name_en: string; code: string };

type Props = {
  existing: ExistingDepartment[];
  locale: string;
  labels: {
    nameFa: string;
    nameEn: string;
    code: string;
    codeHint: string;
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
    backToList: string;
    invalid: string;
    nameRequired: string;
    errorLabel: string;
  };
};

/**
 * Admin-only department creator. The code is the latin prefix of every login
 * code issued in this department, so it is previewed live and validated here
 * before the round-trip (the DB constraint + unique index remain the truth).
 */
export function NewDepartmentForm({ existing, locale, labels }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ nameFa: string; nameEn: string; code: string } | null>(
    null
  );

  const [nameFa, setNameFa] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [code, setCode] = useState('');
  // Once the admin edits the code by hand, stop overwriting it from the name.
  const [codeTouched, setCodeTouched] = useState(false);

  const normalizedCode = normalizeDepartmentCode(code);

  function handleNameEn(value: string) {
    setNameEn(value);
    if (!codeTouched) setCode(suggestDepartmentCode(value));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const fa = nameFa.trim();
    const en = nameEn.trim();
    if (!fa || !en) {
      setError(labels.nameRequired);
      return;
    }
    if (!isValidDepartmentCode(normalizedCode)) {
      setError(labels.invalid);
      return;
    }

    setPending(true);
    const fd = new FormData(e.currentTarget);
    const result = await createDepartment({
      name_fa: fa,
      name_en: en,
      code: normalizedCode,
      kind: (fd.get('kind') as Kind) || 'team',
    });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated({ nameFa: fa, nameEn: en, code: normalizedCode });
  }

  if (created) {
    return (
      <Card className="border-2 border-success/30 bg-success-foreground">
        <CardContent className="space-y-4 pt-6" data-testid="dept-created">
          <h2 className="text-lg font-semibold text-success">{labels.createdTitle}</h2>
          <p className="text-base">
            {locale === 'fa' ? created.nameFa : created.nameEn}{' '}
            <span className="font-mono text-sm text-muted-foreground" dir="ltr">
              ({created.code})
            </span>
          </p>
          <p className="text-sm text-success">{labels.createdHint}</p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild>
              <a href={`/${locale}/manage/employees/new`} data-testid="dept-add-employee">
                {labels.addEmployee}
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/${locale}/manage/employees`}>{labels.backToList}</a>
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
                onChange={(e) => handleNameEn(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="code">{labels.code}</Label>
              {/* Becomes the login-code prefix — latin/digits only, LTR even in fa. */}
              <Input
                id="code"
                name="code"
                data-testid="dept-code"
                required
                dir="ltr"
                autoCapitalize="off"
                autoCorrect="off"
                maxLength={6}
                className="font-mono"
                value={code}
                onChange={(e) => {
                  setCodeTouched(true);
                  setCode(e.target.value);
                }}
              />
              <p className="text-sm text-muted-foreground">{labels.codeHint}</p>
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
                onClick={() => router.push(`/${locale}/manage/employees`)}
              >
                {labels.cancel}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Codes are unique per company — showing the taken ones avoids a round-trip. */}
      {existing.length > 0 && (
        <Card>
          <CardContent className="space-y-2">
            <h2 className="text-base font-semibold">{labels.existingTitle}</h2>
            <ul className="space-y-1" data-testid="dept-existing">
              {existing.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>{locale === 'fa' ? d.name_fa : d.name_en}</span>
                  <span className="font-mono text-muted-foreground" dir="ltr">
                    {d.code}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
