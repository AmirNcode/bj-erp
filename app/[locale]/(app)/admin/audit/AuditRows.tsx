'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { auditValue, changedFields } from '@/lib/admin/format';
import type { AuditRow } from '@/lib/admin/types';

/** Audit entries; each opens to the fields it changed (before → after). */
export function AuditRows({ rows, times }: { rows: AuditRow[]; times: Record<string, string> }) {
  const t = useTranslations('admin.audit');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-muted">
      {rows.map((row) => {
        const changes = changedFields(row.before, row.after);
        const expanded = open === row.id;
        return (
          <li key={row.id} className="py-2.5 text-sm" data-testid="audit-row">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : row.id)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-start"
            >
              <span className="font-medium">{row.actor_name ?? t('system')}</span>
              <span dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.action}</span>
              <span className="text-muted-foreground">
                <span dir="ltr" className="font-mono text-xs">{row.entity}</span>
                {row.entity_label ? ` · ${row.entity_label}` : ''}
              </span>
              {row.about_name && row.about_name !== row.entity_label && (
                <span className="text-xs text-muted-foreground">{t('about')}: {row.about_name}</span>
              )}
              <span className="ms-auto text-xs text-muted-foreground">{times[row.id]}</span>
            </button>
            {expanded && (
              changes.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">{t('noChanges')}</p>
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="data-table w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 text-start font-medium">{t('field')}</th>
                        <th className="px-2 py-1 text-start font-medium">{t('before')}</th>
                        <th className="py-1 text-start font-medium">{t('after')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-muted">
                      {changes.map((c) => (
                        <tr key={c.key} className="align-top">
                          <td dir="ltr" className="py-1 pe-2 font-mono">{c.key}</td>
                          <td className="max-w-64 break-words px-2 py-1 text-muted-foreground">{auditValue(c.before)}</td>
                          <td className="max-w-64 break-words py-1">{auditValue(c.after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}
