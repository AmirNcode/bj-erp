'use client';

import { Label } from '@/components/ui/label';
import { nativeSelectClass } from '@/lib/native-select';
import type { ReplacementCandidate } from '@/lib/leave/replacement';

export type ReplacementLabels = {
  title: string;
  hint: string;
  select: string;
  noReplacement: string;
  onLeave: string;
  loading: string;
  empty: string;
};

/**
 * The جانشین / جایگزین picker, shared by the daily and hourly screens.
 *
 * Unavailable colleagues are rendered DISABLED with their reason rather than
 * omitted, so a worker is told "on leave" instead of wondering where someone went.
 * The field is optional. "No Replacement" is an explicit choice that clears and
 * disables the select while still submitting the existing null value.
 */
export function ReplacementPicker({
  candidates,
  loading,
  value,
  onChange,
  noReplacement,
  onNoReplacementChange,
  labels,
}: {
  candidates: ReplacementCandidate[];
  loading: boolean;
  value: string;
  onChange: (profileId: string) => void;
  noReplacement: boolean;
  onNoReplacementChange: (checked: boolean) => void;
  labels: ReplacementLabels;
}) {
  return (
    <div className="space-y-1.5" data-testid="replacement-picker">
      <Label htmlFor="replacement_id">{labels.title}</Label>
      <p className="text-xs text-muted-foreground">{labels.hint}</p>

      <select
        id="replacement_id"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${nativeSelectClass} disabled:bg-muted`}
        disabled={loading || noReplacement}
        data-testid="replacement-select"
      >
        <option value="">{labels.select}</option>
        {candidates.map((c) => (
          <option key={c.profileId} value={c.profileId} disabled={c.unavailable}>
            {c.fullName} ({c.employeeCode})
            {c.unavailable ? ` — ${labels.onLeave}` : ''}
          </option>
        ))}
      </select>

      <label
        htmlFor="no_replacement"
        className="flex w-fit cursor-pointer items-center gap-2 text-sm"
      >
        <input
          id="no_replacement"
          type="checkbox"
          checked={noReplacement}
          onChange={(event) => {
            const checked = event.target.checked;
            onNoReplacementChange(checked);
            if (checked) onChange('');
          }}
          className="size-4 rounded border-input text-primary focus:ring-ring"
          data-testid="replacement-none"
        />
        <span>{labels.noReplacement}</span>
      </label>

      {loading && <p className="text-xs text-muted-foreground">{labels.loading}</p>}
      {!loading && candidates.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="replacement-empty">
          {labels.empty}
        </p>
      )}
    </div>
  );
}
