'use client';

/**
 * Pick one person by typing a name or personnel number. Suggestions open under
 * the box once 2 characters are typed (Persian digits accepted), show at most
 * `limit` matches sorted by personnel number (low to high), and are chosen by
 * click or arrow keys + Enter. The box then shows the chosen person; × clears it.
 *
 * Replaces long native <select>s of the whole roster (clearance form pickers).
 */

import { useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toAsciiDigits } from '@/lib/employees/code';
import { cn } from '@/lib/utils';

export type PersonSearchOption = { id: string; name: string; personnelNo: string | null };

type Props = {
  people: PersonSearchOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Defaults to «نام یا شماره پرسنلی را تایپ کنید» (personSearch.placeholder). */
  placeholder?: string;
  /** Accessible name when there is no visible <label htmlFor>. */
  ariaLabel?: string;
  id?: string;
  testId: string;
  /** Posts the chosen id ('' when none) with a surrounding <form> under this name. */
  name?: string;
  disabled?: boolean;
  limit?: number;
  minChars?: number;
};

const label = (p: PersonSearchOption) => (p.personnelNo ? `${p.name} (${p.personnelNo})` : p.name);

/** Matches, sorted by personnel number ascending; people without one go last. */
export function searchPeople(
  people: PersonSearchOption[],
  rawQuery: string,
  limit: number,
  minChars = 2
): PersonSearchOption[] {
  const q = toAsciiDigits(rawQuery).trim().toLowerCase();
  if (q.length < minChars) return [];
  const byNumber = (p: PersonSearchOption) =>
    p.personnelNo && /^\d+$/.test(p.personnelNo) ? Number(p.personnelNo) : Number.POSITIVE_INFINITY;
  return people
    .filter((p) => p.name.toLowerCase().includes(q) || (p.personnelNo ?? '').includes(q))
    .sort((a, b) => byNumber(a) - byNumber(b) || a.name.localeCompare(b.name, 'fa'))
    .slice(0, limit);
}

export function PersonSearch({
  people,
  value,
  onChange,
  placeholder,
  ariaLabel,
  id,
  testId,
  name,
  disabled = false,
  limit = 5,
  minChars = 2,
}: Props) {
  const t = useTranslations('personSearch');
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => people.find((p) => p.id === value) ?? null, [people, value]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => searchPeople(people, query, limit, minChars), [people, query, limit, minChars]);
  const showList = open && !selected && toAsciiDigits(query).trim().length >= minChars;

  const choose = (p: PersonSearchOption) => {
    onChange(p.id);
    setQuery('');
    setOpen(false);
  };
  const clear = () => {
    onChange(null);
    setQuery('');
    setActive(0);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        value={selected ? label(selected) : query}
        placeholder={placeholder ?? t('placeholder')}
        disabled={disabled}
        onChange={(e) => {
          if (selected) onChange(null);
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a suggestion lands before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!showList || results.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => (i + 1) % results.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => (i - 1 + results.length) % results.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            choose(results[active] ?? results[0]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        data-testid={testId}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-transparent ps-3 disabled:cursor-not-allowed disabled:opacity-50 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm',
          selected ? 'pe-9 font-medium' : 'pe-3'
        )}
      />
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      {selected && !disabled && (
        <button
          type="button"
          onClick={clear}
          aria-label={t('clear')}
          title={t('clear')}
          className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          data-testid={`${testId}-clear`}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border border-border bg-popover py-1 text-sm shadow-lg"
          data-testid={`${testId}-results`}
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">{t('noResults')}</li>
          ) : (
            results.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-center justify-between gap-3 px-3 py-2', i === active && 'bg-muted')}
                data-testid={`${testId}-option`}
              >
                <span className="truncate">{p.name}</span>
                {p.personnelNo && <span className="shrink-0 font-mono text-xs text-muted-foreground">{p.personnelNo}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
