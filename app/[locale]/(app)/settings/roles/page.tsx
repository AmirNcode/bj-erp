/**
 * Settings › Roles: admin role authoring and scoped approval-delegate self-service.
 */
export const dynamic = 'force-dynamic';

import { setRequestLocale } from 'next-intl/server';
import { getRoleHolders, listRoles } from '@/lib/actions/roles';
import { SettingsTabs } from '../_components/SettingsTabs';
import { redirect } from 'next/navigation';
import { getCachedUser } from '@/lib/auth/context';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { getDelegationContext, searchDelegates } from '@/lib/actions/approval-delegation';
import { DelegationPanel } from './_components/DelegationPanel';
import { RolesList } from './_components/RolesList';

type Props = { params: Promise<{ locale: string }> };

export default async function RolesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const capabilities = await getApprovalCapabilities();
  if (!capabilities.isAdmin && !capabilities.canDelegate) redirect(`/${locale}/home`);
  const [context, list] = await Promise.all([
    getDelegationContext(),
    capabilities.isAdmin ? listRoles() : Promise.resolve(null),
  ]);
  const roles = list?.ok ? list.roles : [];
  const adminRole = roles.find((r) => r.systemKey === 'admin');
  const [holders, candidates] = await Promise.all([
    adminRole ? getRoleHolders(adminRole.id) : Promise.resolve(null),
    context.ok && context.context.can_delegate && context.context.can_approve
      ? searchDelegates(context.context.principal_id) : Promise.resolve(null),
  ]);
  const adminHolder = holders?.ok ? (holders.holders[0] ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <SettingsTabs locale={locale} active="roles" />
      {list && !list.ok && (
        <p role="alert" className="text-sm text-destructive">
          {list.error}
        </p>
      )}
      {!context.ok && <p role="alert" className="text-sm text-destructive">{context.error}</p>}
      {context.ok && <DelegationPanel key={JSON.stringify(context.context)} initial={context.context} initialCandidates={candidates?.ok ? candidates.candidates : []} locale={locale} />}
      {candidates && !candidates.ok && <p role="alert" className="text-sm text-destructive">{candidates.error}</p>}
      {capabilities.isAdmin && <RolesList roles={roles} adminHolder={adminHolder} locale={locale} />}
    </div>
  );
}
