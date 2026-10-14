'use client';

/**
 * D1: the only way admin moves. The admin picks an active employee, types that
 * person's personnel number (their employee code when they have none; a typo
 * guard) and their own password. On success
 * the caller is no longer admin, so the app goes Home with a refreshed session
 * (transferAdmin refreshes it server-side).
 */

import { useState, useTransition } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { PersonSearch, type PersonSearchOption } from '@/components/PersonSearch';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { listTransferCandidates, transferAdmin } from '@/lib/actions/roles';

type FieldErrors = { personnelNo?: string; password?: string; form?: string };

export function TransferAdminDialog({ locale }: { locale: string }) {
  const t = useTranslations('rolesAdmin');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<PersonSearchOption[]>([]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [personnelNo, setPersonnelNo] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isPending, startTransition] = useTransition();
  const [, startLoading] = useTransition();

  const reset = () => {
    setTargetId(null);
    setPersonnelNo('');
    setPassword('');
    setErrors({});
  };

  const onOpenChange = (next: boolean) => {
    if (isPending) return;
    setOpen(next);
    reset();
    if (!next) return;
    startLoading(async () => {
      const r = await listTransferCandidates();
      if (!r.ok) {
        setErrors({ form: t('transfer.loadFailed') });
        return;
      }
      setPeople(r.people);
    });
  };

  const ready = !!targetId && personnelNo.trim() !== '' && password !== '';
  // An account with no personnel number (the bootstrap admin) is confirmed by its
  // employee code, which may hold letters: offer a text keyboard for it.
  const target = people.find((p) => p.id === targetId);
  const typed = target?.personnelNo && !/^\d+$/.test(target.personnelNo) ? 'text' : 'numeric';

  const confirm = () => {
    if (!ready) return;
    setErrors({});
    startTransition(async () => {
      const r = await transferAdmin({ targetId: targetId!, personnelNo: personnelNo.trim(), password });
      if (!r.ok) {
        if (r.field === 'personnel_no') setErrors({ personnelNo: r.error });
        else if (r.field === 'password') setErrors({ password: r.error });
        else setErrors({ form: r.error });
        return;
      }
      setOpen(false);
      router.replace(`/${locale}/home`);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-10" data-testid="transfer-admin">
          {t('actions.transfer')}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        // Start on the person search, the first thing to fill (Radix would pick the first
        // enabled field; the search was disabled while the list loads).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById('transfer-person')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('transfer.title')}</DialogTitle>
          <DialogDescription>{t('transfer.intro')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-person">{t('transfer.person')}</Label>
            <PersonSearch
              id="transfer-person"
              people={people}
              value={targetId}
              onChange={setTargetId}
              disabled={isPending}
              testId="transfer-person"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-personnel-no">{t('transfer.personnelNo')}</Label>
            <Input
              id="transfer-personnel-no"
              inputMode={typed}
              dir="ltr"
              autoComplete="off"
              value={personnelNo}
              disabled={isPending}
              aria-invalid={errors.personnelNo ? true : undefined}
              className="h-10"
              data-testid="transfer-personnel-no"
              onChange={(e) => {
                setPersonnelNo(e.target.value);
                setErrors((x) => ({ ...x, personnelNo: undefined }));
              }}
            />
            {errors.personnelNo && (
              <p role="alert" className="text-sm text-destructive" data-testid="transfer-personnel-no-error">
                {errors.personnelNo}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-password">{t('transfer.password')}</Label>
            <Input
              id="transfer-password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              value={password}
              disabled={isPending}
              aria-invalid={errors.password ? true : undefined}
              className="h-10"
              data-testid="transfer-password"
              onChange={(e) => {
                setPassword(e.target.value);
                setErrors((x) => ({ ...x, password: undefined }));
              }}
            />
            {errors.password && (
              <p role="alert" className="text-sm text-destructive" data-testid="transfer-password-error">
                {errors.password}
              </p>
            )}
          </div>

          <div
            role="note"
            className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-foreground p-3 text-sm text-warning"
            data-testid="transfer-warning"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t('transfer.warning')}</span>
          </div>

          {errors.form && (
            <p role="alert" className="text-sm text-destructive" data-testid="transfer-error">
              {errors.form}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="h-10" disabled={isPending} onClick={() => onOpenChange(false)}>
            {t('transfer.cancel')}
          </Button>
          <Button
            variant="destructive"
            className="h-10"
            disabled={!ready || isPending}
            onClick={confirm}
            data-testid="transfer-confirm"
          >
            {isPending ? t('transfer.transferring') : t('transfer.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
