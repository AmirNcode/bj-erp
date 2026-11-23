'use client';

/**
 * Settings › Roles list (spec "Roles list"): one card, one row per role, in
 * app_list_roles order (system, presets, custom).
 * - Admin: lock, holder, Transfer admin.
 * - Manager / Employee: a muted note, no actions.
 * - Presets: Built-in badge, holders, Edit.
 * - Custom: holders, Edit, Delete.
 */

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { RoleRow } from '@/lib/actions/roles-helpers';
import { DeleteRoleDialog } from './DeleteRoleDialog';
import { TransferAdminDialog } from './TransferAdminDialog';

export function RolesList({
  roles,
  adminHolder,
  locale,
}: {
  roles: RoleRow[];
  adminHolder: { fullName: string; personnelNo: string } | null;
  locale: string;
}) {
  const t = useTranslations('rolesAdmin');
  const base = `/${locale}/settings/roles`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <Button asChild className="h-10">
          <Link href={`${base}/new`} data-testid="role-new">
            {t('newRole')}
          </Link>
        </Button>
      </div>

      <Card className="gap-0 divide-y py-0" data-testid="roles-list">
        {roles.map((r) => {
          const isAdmin = r.systemKey === 'admin';
          const isSystem = r.kind === 'system';
          return (
            <div
              key={r.id}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              data-testid={`role-row-${r.id}`}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {isAdmin && <Lock className="size-4 text-muted-foreground" aria-hidden="true" />}
                  <span className="font-medium" dir="ltr">
                    {r.name}
                  </span>
                  {r.kind === 'preset' && <Badge variant="secondary">{t('builtIn')}</Badge>}
                  {!isSystem && (
                    <span className="text-xs text-muted-foreground" data-testid={`role-holders-${r.id}`}>
                      {t('holders', { count: r.holders })}
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('adminRow')}{' '}
                    {adminHolder ? (
                      <span className="text-foreground" data-testid="admin-holder">
                        {adminHolder.fullName}
                        {/* The bootstrap admin has no personnel number: no dangling separator. */}
                        {adminHolder.personnelNo && (
                          <>
                            {' · '}
                            <bdi className="font-mono tabular-nums">{adminHolder.personnelNo}</bdi>
                          </>
                        )}
                      </span>
                    ) : (
                      t('noAdmin')
                    )}
                  </p>
                )}
                {r.systemKey === 'manager' && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('managerNote')}</p>
                )}
                {r.systemKey === 'employee' && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('employeeNote')}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {isAdmin && <TransferAdminDialog locale={locale} />}
                {!isSystem && (
                  <Button asChild variant="outline" size="sm" className="h-10">
                    <Link href={`${base}/${r.id}`} data-testid={`role-edit-${r.id}`}>
                      {t('actions.edit')}
                    </Link>
                  </Button>
                )}
                {r.kind === 'custom' && <DeleteRoleDialog roleId={r.id} roleName={r.name} />}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
