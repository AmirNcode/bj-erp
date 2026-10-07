'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { renameDepartment, setDepartmentManager } from '@/lib/actions/departments';
import { DepartmentMembersDialog, type DialogDepartment } from './DepartmentMembersDialog';

type Department = {
  id: string;
  name_fa: string;
  name_en: string;
  code: string;
  manager_id: string | null;
  manager_name: string | null;
};

type Props = {
  departments: Department[];
  /** Active holders of the `manager` role — the department-manager picker's options. */
  managers: { id: string; fullName: string }[];
  /** Non-null when the read FAILED — distinct from "there are none". */
  loadError?: string | null;
  locale: string;
  labels: {
    title: string;
    hint: string;
    addNew: string;
    empty: string;
    managersLabel: string;
    workersLabel: string;
    noMembers: string;
    loading: string;
    close: string;
    managerLabel: string;
    noManager: string;
    managerSaved: string;
    rename: string;
    nameFa: string;
    nameEn: string;
    save: string;
    cancel: string;
    renamed: string;
    errorLabel: string;
  };
};

/** Stable, latin, human-readable testid suffix. */
function slug(nameEn: string): string {
  return nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Settings → Departments (spec 2026-07-30 §7). Each row shows the name, the
 * read-only code (the bulk-import key since FR-46) and the department manager
 * picker (FR-47 — the second signer on the department's requests). The name
 * opens the members panel; *Rename* edits both names in place (FR-51); *Add
 * Department* lives here, not on the Employees page (D9).
 */
export function DepartmentsCard({ departments, managers, loadError = null, locale, labels }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState<DialogDepartment | null>(null);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string; nameFa: string; nameEn: string } | null>(null);

  const saveName = () => {
    if (!editing) return;
    startTransition(async () => {
      const result = await renameDepartment(editing.id, {
        name_fa: editing.nameFa,
        name_en: editing.nameEn,
      });
      if (!result.ok) {
        toast.error(`${labels.errorLabel}: ${result.error}`);
        return;
      }
      toast.success(labels.renamed);
      setEditing(null);
      router.refresh();
    });
  };

  const changeManager = (departmentId: string, managerId: string) => {
    startTransition(async () => {
      const result = await setDepartmentManager(departmentId, managerId || null);
      if (!result.ok) {
        toast.error(`${labels.errorLabel}: ${result.error}`);
        return;
      }
      toast.success(labels.managerSaved);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{labels.title}</h2>
        <p className="text-sm text-muted-foreground mt-1">{labels.hint}</p>
      </div>

      {loadError ? (
        /* A failed read must not render as an empty list — an admin would
           reasonably conclude the departments had been deleted. */
        <p role="alert" className="text-sm text-destructive" data-testid="dept-list-error">
          {labels.errorLabel}: {loadError}
        </p>
      ) : departments.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="dept-list-empty">
          {labels.empty}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border" data-testid="dept-list">
          {departments.map((d) => {
            const name = locale === 'fa' ? d.name_fa : d.name_en;
            if (editing?.id === d.id) {
              return (
                <li key={d.id} className="px-3 py-2">
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveName();
                    }}
                  >
                    <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                      {labels.nameFa}
                      <Input
                        value={editing.nameFa}
                        onChange={(e) => setEditing({ ...editing, nameFa: e.target.value })}
                        required
                        dir="rtl"
                        data-testid="dept-name-fa-input"
                      />
                    </label>
                    <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                      {labels.nameEn}
                      <Input
                        value={editing.nameEn}
                        onChange={(e) => setEditing({ ...editing, nameEn: e.target.value })}
                        required
                        dir="ltr"
                        data-testid="dept-name-en-input"
                      />
                    </label>
                    <Button type="submit" size="sm" disabled={isPending} data-testid="dept-rename-save">
                      {labels.save}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>
                      {labels.cancel}
                    </Button>
                  </form>
                </li>
              );
            }
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 text-start text-sm transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-none"
                  data-testid={`dept-row-${slug(d.name_en)}`}
                  onClick={() => setOpen({ id: d.id, name })}
                >
                  <span className="truncate">{name}</span>
                  <span
                    className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                    dir="ltr"
                    data-testid={`dept-code-${slug(d.name_en)}`}
                  >
                    {d.code}
                  </span>
                </button>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{labels.managerLabel}</span>
                  <select
                    value={d.manager_id ?? ''}
                    disabled={isPending}
                    onChange={(e) => changeManager(d.id, e.target.value)}
                    className="h-8 max-w-48 rounded-md border border-input bg-background ps-2 text-sm text-foreground"
                    data-testid={`dept-manager-${slug(d.name_en)}`}
                  >
                    <option value="">{labels.noManager}</option>
                    {/* Keep a current manager selectable even if they no longer
                        hold the role, so the select never silently shows "none". */}
                    {d.manager_id && !managers.some((m) => m.id === d.manager_id) && (
                      <option value={d.manager_id}>{d.manager_name ?? '—'}</option>
                    )}
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.fullName}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setEditing({ id: d.id, nameFa: d.name_fa, nameEn: d.name_en })}
                  data-testid={`dept-rename-${slug(d.name_en)}`}
                >
                  {labels.rename}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Button variant="outline" size="sm" asChild>
        <Link href={`/${locale}/manage/departments/new`} data-testid="add-department-link">
          {labels.addNew}
        </Link>
      </Button>

      <DepartmentMembersDialog
        department={open}
        onClose={() => setOpen(null)}
        labels={{
          managersLabel: labels.managersLabel,
          workersLabel: labels.workersLabel,
          noMembers: labels.noMembers,
          loading: labels.loading,
          close: labels.close,
          errorLabel: labels.errorLabel,
        }}
      />
    </div>
  );
}
