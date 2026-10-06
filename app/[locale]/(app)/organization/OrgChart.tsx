'use client';

/**
 * Organization tab (FR-44). Opens on the viewer's own card: the chain above
 * them up to the top, their direct reports below. Clicking any card refocuses
 * on that person. Focus lives in `?p=<id>` (`?p=top` = everyone with no
 * manager), written with the native History API so a click is instant — Next
 * keeps `useSearchParams` in sync — and browser Back walks the path.
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  buildOrgIndex,
  chainTo,
  reportsOf,
  searchPeople,
  type OrgPerson,
} from '@/lib/org/tree';

type Labels = {
  searchPlaceholder: string;
  noResults: string;
  top: string;
  topTitle: string;
  you: string;
  departmentManager: string;
  reportsTo: string;
  /** Raw: {count}. */
  directReports: string;
  noReports: string;
  /** Raw: {count}. */
  people: string;
  backToMe: string;
  empty: string;
};

type Props = {
  people: OrgPerson[];
  myId: string;
  locale: string;
  labels: Labels;
};

const TOP = 'top';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return `${first}${last ? '‌' + last : ''}`;
}

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export function OrgChart({ people, myId, locale, labels }: Props) {
  const index = useMemo(() => buildOrgIndex(people), [people]);
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');

  const requested = searchParams.get('p');
  const focusId =
    requested === TOP ? TOP : requested && index.byId.has(requested) ? requested : index.byId.has(myId) ? myId : TOP;

  const go = (id: string) => {
    setQuery('');
    window.history.pushState(null, '', `?p=${encodeURIComponent(id)}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const fmt = (n: number) => new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(n);
  const deptName = (p: OrgPerson) =>
    (locale === 'fa' ? p.departmentNameFa : p.departmentNameEn) ?? p.departmentNameFa ?? p.departmentNameEn;

  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground" data-testid="org-empty">{labels.empty}</p>;
  }

  const results = searchPeople(index, query);
  const focus = focusId === TOP ? null : index.byId.get(focusId) ?? null;
  const chain = focus ? chainTo(index, focus.id) : [];
  const reports = focus ? reportsOf(index, focus.id) : index.roots;
  const manager = focus?.managerId ? index.byId.get(focus.managerId) : undefined;

  // A render helper, not a nested component: a component declared inside
  // render would remount on every navigation.
  const personCard = (person: OrgPerson, testId: string) => {
    const count = reportsOf(index, person.id).length;
    return (
      <button
        key={person.id}
        type="button"
        onClick={() => go(person.id)}
        data-testid={testId}
        data-person={person.id}
        className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-start shadow-xs transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
        >
          {initials(person.fullName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{person.fullName}</span>
            {person.id === myId && (
              <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                {labels.you}
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[person.jobTitle, deptName(person)].filter(Boolean).join(' · ')}
          </span>
        </span>
        {count > 0 && (
          <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {fill(labels.people, { count: fmt(count) })}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-5" data-testid="org-chart">
      {/* Jump to anyone by name. */}
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          data-testid="org-search"
          className="h-10 w-full rounded-lg border border-input bg-card ps-9 pe-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {query.trim() && (
          <ul
            className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
            data-testid="org-search-results"
          >
            {results.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted-foreground">{labels.noResults}</li>
            ) : (
              results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => go(p.id)}
                    data-testid="org-search-result"
                    className="flex w-full flex-col items-start rounded-md px-3 py-2 text-start hover:bg-secondary"
                  >
                    <span className="text-sm font-medium">{p.fullName}</span>
                    <span className="text-xs text-muted-foreground">
                      {[p.jobTitle, deptName(p)].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Chain above the focus: top of the organisation first. */}
      <nav aria-label={labels.reportsTo} className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => go(TOP)}
            data-testid="org-top"
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors',
              focusId === TOP
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-primary'
            )}
          >
            {labels.top}
          </button>
          {focusId !== myId && index.byId.has(myId) && (
            <button
              type="button"
              onClick={() => go(myId)}
              data-testid="org-back-to-me"
              className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"
            >
              {labels.backToMe}
            </button>
          )}
        </div>
        {chain.length > 0 && (
          <ol className="ms-4 space-y-1.5 border-s-2 border-primary/20 ps-4" data-testid="org-chain">
            {chain.map((p) => (
              <li key={p.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -start-[1.4rem] top-1/2 size-2.5 -translate-y-1/2 rounded-full border-2 border-primary/40 bg-background"
                />
                <button
                  type="button"
                  onClick={() => go(p.id)}
                  data-testid="org-chain-item"
                  data-person={p.id}
                  className="flex w-full flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1 text-start hover:bg-secondary"
                >
                  <span className="text-sm font-medium">{p.fullName}</span>
                  <span className="text-xs text-muted-foreground">{p.jobTitle}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </nav>

      {/* The focused person. */}
      {focus ? (
        <section
          className="rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5"
          data-testid="org-focus"
          data-person={focus.id}
        >
          <div className="flex items-start gap-4">
            <span
              aria-hidden
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground"
            >
              {initials(focus.fullName)}
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">{focus.fullName}</h2>
                {focus.id === myId && (
                  <span className="rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                    {labels.you}
                  </span>
                )}
                {focus.isDepartmentManager && (
                  <span
                    className="rounded border border-primary/30 px-1.5 py-0.5 text-xs text-primary"
                    data-testid="org-focus-dept-manager"
                  >
                    {labels.departmentManager}
                  </span>
                )}
              </div>
              {focus.jobTitle && <p className="text-sm">{focus.jobTitle}</p>}
              {deptName(focus) && (
                <p className="text-sm text-muted-foreground" data-testid="org-focus-department">
                  {deptName(focus)}
                </p>
              )}
              {manager && (
                <p className="text-xs text-muted-foreground">
                  {labels.reportsTo}:{' '}
                  <button
                    type="button"
                    onClick={() => go(manager.id)}
                    className="font-medium text-primary hover:underline"
                    data-testid="org-focus-manager"
                  >
                    {manager.fullName}
                  </button>
                </p>
              )}
            </div>
          </div>
        </section>
      ) : (
        <h2 className="text-base font-semibold" data-testid="org-roots-title">
          {labels.topTitle}
        </h2>
      )}

      {/* Direct reports (or, at the top, everyone without a manager). */}
      <section className="space-y-2">
        {focus && (
          <h3 className="text-sm font-semibold text-muted-foreground">
            {fill(labels.directReports, { count: fmt(reports.length) })}
          </h3>
        )}
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="org-no-reports">
            {labels.noReports}
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid={focus ? 'org-reports' : 'org-roots'}>
            {reports.map((p) => personCard(p, focus ? 'org-report-card' : 'org-root-card'))}
          </div>
        )}
      </section>
    </div>
  );
}
