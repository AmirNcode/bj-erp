'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { nativeSelectClass } from '@/lib/native-select';
import { filterCandidates, type ReplacementCandidate } from '@/lib/leave/replacement';

export type ReplacementLabels = {
  title: string;
  hint: string;
  searchPlaceholder: string;
  none: string;
  onLeave: string;
  loading: string;
  empty: string;
};

/**
 * The جانشین / جایگزین picker, shared by the daily and hourly screens.
 *
 * Searchable via a filter input over a NATIVE <select> rather than a shadcn
 * Command/Popover combo: `components/ui` has no `command` primitive, and adding
 * one pulls cmdk through a network install this machine cannot do. The native
 * select is also what the e2e suite drives with `selectOption`, and it is the
 * better control on a phone.
 *
 * Unavailable colleagues are rendered DISABLED with their reason rather than
 * omitted, so a worker is told "on leave" instead of wondering where someone went.
 * The field is optional; an empty selection submits as null.
 */
export function ReplacementPicker({
  candidates,
  loading,
  value,
  onChange,
  labels,
}: {
  candidates: ReplacementCandidate[];
  loading: boolean;
  value: string;
  onChange: (profileId: string) => void;
  labels: ReplacementLabels;
}) {
  const [query, setQuery] = useState('');
  const shown = filterCandidates(candidates, query);

  return (
    <div className="space-y-1.5" data-testid="replacement-picker">
      <Label htmlFor="replacement_id">{labels.title}</Label>
      <p className="text-xs text-muted-foreground">{labels.hint}</p>

      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={labels.searchPlaceholder}
        disabled={loading || candidates.length === 0}
        data-testid="replacement-search"
        aria-label={labels.searchPlaceholder}
      />

      <select
        id="replacement_id"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={nativeSelectClass}
        disabled={loading}
        data-testid="replacement-select"
      >
        <option value="">{labels.none}</option>
        {shown.map((c) => (
          <option key={c.profileId} value={c.profileId} disabled={c.unavailable}>
            {c.fullName} ({c.employeeCode})
            {c.unavailable ? ` — ${labels.onLeave}` : ''}
          </option>
        ))}
      </select>

      {loading && <p className="text-xs text-muted-foreground">{labels.loading}</p>}
      {!loading && candidates.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="replacement-empty">
          {labels.empty}
        </p>
      )}
    </div>
  );
}
