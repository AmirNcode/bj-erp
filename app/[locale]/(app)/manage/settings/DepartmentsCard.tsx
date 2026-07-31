'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { DepartmentMembersDialog, type DialogDepartment } from './DepartmentMembersDialog';

type Department = { id: string; name_fa: string; name_en: string };

type Props = {
  departments: Department[];
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
    errorLabel: string;
  };
};

/** Stable, latin, human-readable testid suffix — the code is no longer shown. */
function slug(nameEn: string): string {
  return nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/**
 * Settings → Departments (spec 2026-07-30 §7). Read-only: it lists NAMES only,
 * never codes — since 20260730130002 a department code prefixes nothing, so it
 * is not a number an admin should be invited to reason about (D13). Each row
 * opens the members panel; *Add Department* lives here now, not on the
 * Employees page (D9).
 */
export function DepartmentsCard({ departments, loadError = null, locale, labels }: Props) {
  const [open, setOpen] = useState<DialogDepartment | null>(null);

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
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start text-sm transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none"
                  data-testid={`dept-row-${slug(d.name_en)}`}
                  onClick={() => setOpen({ id: d.id, name })}
                >
                  <span>{name}</span>
                  <span aria-hidden className="text-muted-foreground rtl:rotate-180">
                    ›
                  </span>
                </button>
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
