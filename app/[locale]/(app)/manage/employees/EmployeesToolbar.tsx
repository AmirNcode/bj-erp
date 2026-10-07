'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { employeesHref, type EmployeesFilter, type EmployeesQuery } from '@/lib/employees/list';
import { nativeSelectClass } from '@/lib/native-select';
import { cn } from '@/lib/utils';

type Props = {
  /** Locale-prefixed list path, e.g. /fa/manage/employees. */
  base: string;
  query: EmployeesQuery;
  /** Pre-formatted segment counts; `reports` is null for non-managers, `incomplete` for non-hr/admin. */
  counts: { all: string; reports: string | null; inactive: string; incomplete: string | null };
  departments: { id: string; name: string }[];
  labels: {
    filterLabel: string;
    filterAll: string;
    filterReports: string;
    filterInactive: string;
    filterIncomplete: string;
    search: string;
    department: string;
    allDepartments: string;
  };
};

/**
 * Filter segment, search and department select. All state lives in the URL
 * (q, dept, filter, page); changing anything resets to page 1.
 */
export function EmployeesToolbar({ base, query, counts, departments, labels }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q);
  const lastPushed = useRef(query.q);

  const go = (next: Partial<EmployeesQuery>) =>
    startTransition(() => {
      router.replace(employeesHref(base, { ...query, page: 1, ...next }), { scroll: false });
    });

  // Debounced search: typing does not push a URL per keystroke.
  useEffect(() => {
    if (q.trim() === lastPushed.current.trim()) return;
    const timer = setTimeout(() => {
      lastPushed.current = q;
      go({ q: q.trim() });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` closes over the current query
  }, [q]);

  const segments: { key: EmployeesFilter; label: string; count: string | null }[] = [
    { key: 'all', label: labels.filterAll, count: counts.all },
    ...(counts.reports !== null
      ? [{ key: 'reports' as const, label: labels.filterReports, count: counts.reports }]
      : []),
    { key: 'inactive', label: labels.filterInactive, count: counts.inactive },
    ...(counts.incomplete !== null
      ? [{ key: 'incomplete' as const, label: labels.filterIncomplete, count: counts.incomplete }]
      : []),
  ];

  return (
    <div
      className={cn('flex w-full flex-wrap items-center gap-2.5 transition-opacity lg:flex-nowrap', isPending && 'opacity-70')}
      aria-busy={isPending}
    >
      <nav
        aria-label={labels.filterLabel}
        className="flex max-w-full shrink-0 overflow-x-auto rounded-[10px] bg-muted p-[3px]"
      >
        {segments.map((s) => {
          const active = query.filter === s.key;
          return (
            <Link
              key={s.key}
              href={employeesHref(base, { ...query, filter: s.key, page: 1 })}
              replace
              scroll={false}
              data-testid={`emp-filter-${s.key}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] transition-colors',
                active
                  ? 'bg-card font-semibold text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {s.label}
              {s.count !== null && (
                <span className={cn('text-xs', active ? 'text-primary/70' : 'text-muted-foreground')}>
                  {s.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <form
        role="search"
        className="relative w-full min-w-0 sm:w-auto sm:min-w-[220px] sm:flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          lastPushed.current = q;
          go({ q: q.trim() });
        }}
      >
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          data-testid="emp-search"
          className="h-9 w-full rounded-[10px] border border-input bg-card ps-9 pe-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </form>

      <select
        aria-label={labels.department}
        data-testid="emp-dept-filter"
        value={query.dept ?? ''}
        onChange={(e) => go({ dept: e.target.value || null })}
        className={cn(nativeSelectClass, 'h-9 w-full shrink-0 rounded-[10px] sm:w-56')}
      >
        <option value="">{labels.allDepartments}</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
