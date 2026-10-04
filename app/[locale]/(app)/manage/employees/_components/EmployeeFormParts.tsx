'use client';

/** Pieces shared by the Add and Edit employee forms. */

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Rendered as raw slugs. The e2e `createEmployee` helper picks these checkboxes
// by their exact label text, so translating them is a separate, deliberate
// change (docs/TASKS.md).
export const ROLES = ['admin', 'manager', 'employee', 'security', 'hr'] as const;
export type Role = (typeof ROLES)[number];

/** Stable test-id slug for a leave type: `annual`, `sick`, or its English name. */
export function leaveTypeSlug(type: { name_en: string | null; name_fa: string }) {
  const label = (type.name_en ?? type.name_fa).toLowerCase();
  if (label.includes('annual')) return 'annual';
  if (label.includes('sick')) return 'sick';
  return label.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'leave';
}

/** Minutes -> the days figure a policy input shows. 0 means unset ("no cap" for the annual cap). */
export function minutesToDaysInput(minutes: number | null | undefined, hoursPerDay: number): number {
  if (!minutes || minutes <= 0) return 0;
  return Math.round((minutes / (hoursPerDay * 60)) * 100) / 100;
}

/** Native checkboxes: the e2e suite checks them through their label text. */
export function RoleCheckboxes({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: Role[];
  onChange: (roles: Role[]) => void;
}) {
  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium leading-none">{label}</span>
      <div className="flex flex-wrap gap-3">
        {ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={() =>
                onChange(
                  selected.includes(role) ? selected.filter((r) => r !== role) : [...selected, role]
                )
              }
              className="rounded border-input text-primary focus:ring-ring"
            />
            <span className="text-sm">{role}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export type PolicyLabels = {
  policyRate: string;
  policyRateHint: string;
  policyAnnualCap: string;
  policyAnnualCapHint: string;
  policyCarryCap: string;
  policyCarryCapHint: string;
};

/**
 * One leave type's accrual policy, in days. Uncontrolled inputs named
 * `policy_rate_<id>`, `policy_cap_<id>` and `policy_carry_<id>`: the forms read
 * them from FormData on submit and convert to minutes there.
 */
export function AccrualPolicyFields({
  leaveTypeId,
  slug,
  legend,
  defaults,
  labels,
}: {
  leaveTypeId: string;
  slug: string;
  legend: string;
  defaults: { rate: number; cap: number; carry: number };
  labels: PolicyLabels;
}) {
  const fields = [
    { key: 'rate', label: labels.policyRate, hint: labels.policyRateHint, value: defaults.rate },
    { key: 'cap', label: labels.policyAnnualCap, hint: labels.policyAnnualCapHint, value: defaults.cap },
    { key: 'carry', label: labels.policyCarryCap, hint: labels.policyCarryCapHint, value: defaults.carry },
  ];
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {fields.map((field) => {
          const id = `policy_${field.key}_${leaveTypeId}`;
          return (
            <div className="space-y-1" key={field.key}>
              <Label htmlFor={id} className="text-xs">
                {field.label}
              </Label>
              <Input
                id={id}
                name={id}
                type="number"
                min={0}
                step="0.5"
                defaultValue={field.value}
                aria-describedby={`policy_${field.key}_hint_${leaveTypeId}`}
                data-testid={`policy-${field.key}-${slug}`}
              />
              <p id={`policy_${field.key}_hint_${leaveTypeId}`} className="text-xs text-muted-foreground">
                {field.hint}
              </p>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
