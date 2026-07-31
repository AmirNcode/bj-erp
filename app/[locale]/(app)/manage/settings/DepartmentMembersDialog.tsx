'use client';

import { useEffect, useState } from 'react';
import {
  getDepartmentMembers,
  type DepartmentMember,
  type DepartmentMembers,
} from '@/lib/actions/departments';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type DialogDepartment = { id: string; name: string };

type Props = {
  /** The open department, or null when the dialog is closed. */
  department: DialogDepartment | null;
  onClose: () => void;
  labels: {
    managersLabel: string;
    workersLabel: string;
    noMembers: string;
    loading: string;
    errorLabel: string;
  };
};

function MemberGroup({ title, people }: { title: string; people: DepartmentMember[] }) {
  if (people.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      <ul className="space-y-1">
        {people.map((person) => (
          <li key={person.id} className="flex items-center justify-between gap-3 text-sm">
            <span>{person.fullName}</span>
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {person.employeeCode}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Who works in a department (spec 2026-07-30 §7). Radix supplies outside-click
 * and Esc dismissal; its built-in close button is positioned `top-4 end-4`,
 * which renders top-LEFT under RTL Farsi and top-right under LTR English —
 * the requested placement, mirrored correctly, so it is left alone.
 *
 * Members are fetched when the dialog opens rather than with the page: the
 * admin usually opens one department, not all of them.
 */
type Loaded = { id: string; members?: DepartmentMembers; error?: string };

export function DepartmentMembersDialog({ department, onClose, labels }: Props) {
  const departmentId = department?.id ?? null;
  // Keyed by department id rather than cleared on open: that keeps the effect
  // free of a synchronous setState, and a result for a department the admin
  // has already navigated away from is ignored instead of flashing.
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!departmentId) return;

    let active = true;
    getDepartmentMembers(departmentId).then((result) => {
      if (!active) return;
      setLoaded(
        result.ok
          ? { id: departmentId, members: result.members }
          : { id: departmentId, error: result.error }
      );
    });

    return () => {
      active = false;
    };
  }, [departmentId]);

  const current = departmentId && loaded?.id === departmentId ? loaded : null;
  const members = current?.members ?? null;
  const error = current?.error ?? null;
  const isEmpty =
    members !== null && members.managers.length === 0 && members.workers.length === 0;

  return (
    <Dialog open={department !== null} onOpenChange={(open) => !open && onClose()}>
      {/* No description to announce — opt out rather than invent copy. */}
      <DialogContent aria-describedby={undefined} data-testid="dept-members-dialog">
        <DialogHeader>
          <DialogTitle>{department?.name ?? ''}</DialogTitle>
        </DialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="dept-members-error">
            {labels.errorLabel}: {error}
          </p>
        ) : members === null ? (
          <p className="text-sm text-muted-foreground" data-testid="dept-members-loading">
            {labels.loading}
          </p>
        ) : isEmpty ? (
          <p className="text-sm text-muted-foreground" data-testid="dept-members-empty">
            {labels.noMembers}
          </p>
        ) : (
          <div className="space-y-4" data-testid="dept-members-list">
            <MemberGroup title={labels.managersLabel} people={members.managers} />
            <MemberGroup title={labels.workersLabel} people={members.workers} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
