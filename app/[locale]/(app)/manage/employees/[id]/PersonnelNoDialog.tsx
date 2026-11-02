'use client';

/**
 * Admin only (owner, 2026-11-02): the login code in the Edit Employee header is
 * a button that opens this dialog. Saving a new personnel number makes it the
 * login code too (app_admin_set_personnel_no); everyone else sees plain text.
 */

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

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
import { setPersonnelNo } from '@/lib/actions/employees';
import { isValidPersonnelNo, normalizePersonnelNo } from '@/lib/employees/code';

type Props = { employeeId: string; employeeCode: string; personnelNo: string | null };

export function PersonnelNoDialog({ employeeId, employeeCode, personnelNo }: Props) {
  const t = useTranslations('manage.employees');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(personnelNo ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const onOpenChange = (next: boolean) => {
    if (isPending) return;
    setOpen(next);
    setValue(personnelNo ?? '');
    setError(null);
  };

  const pno = normalizePersonnelNo(value);
  const ready = isValidPersonnelNo(pno) && pno !== personnelNo;

  const save = () => {
    if (!ready) return;
    setError(null);
    startTransition(async () => {
      const r = await setPersonnelNo(employeeId, pno);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      toast.success(t('personnelNoSaved'));
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="font-mono text-sm text-muted-foreground"
          dir="ltr"
          title={t('editPersonnelNo')}
          data-testid="edit-personnel-no"
        >
          {employeeCode}
          <Pencil className="size-3.5" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('editPersonnelNo')}</DialogTitle>
          <DialogDescription>{t('editPersonnelNoHint')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="edit-personnel-no-input">{t('personnelNo')}</Label>
          <Input
            id="edit-personnel-no-input"
            inputMode="numeric"
            dir="ltr"
            autoComplete="off"
            className="h-10"
            value={value}
            disabled={isPending}
            aria-invalid={error ? true : undefined}
            data-testid="edit-personnel-no-input"
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
          <p className="text-xs text-muted-foreground" dir="auto">
            {t('currentLoginCode', { code: employeeCode })}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="edit-personnel-no-error">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!ready || isPending} data-testid="edit-personnel-no-save">
            {t('savePersonnelNo')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
