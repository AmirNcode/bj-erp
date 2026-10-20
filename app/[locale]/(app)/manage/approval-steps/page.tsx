/**
 * Manage › Approval steps (FR-36, FR-42): who must sign, in what order, and
 * whether that order binds. The chain is shown to callers with approval_steps
 * read and edited with approval_steps edit (FR-55); approval_steps edit also
 * makes the order binding (FR-66). Everyone else is sent home.
 */
export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedPermissions } from '@/lib/auth/context';
import { can } from '@/lib/permissions/catalog';
import { getApprovalSteps } from '@/lib/actions/settings';
import { PageHeader } from '../../_components/PageHeader';
import { ApprovalStepsCard } from './ApprovalStepsCard';

type Props = { params: Promise<{ locale: string }> };

export default async function ApprovalStepsPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const perms = await getCachedPermissions(user.id);
  if (!can(perms, 'approval_steps', 'read')) redirect(`/${locale}/home`);

  const tNav = await getTranslations('nav');
  const approvalData = await getApprovalSteps();

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <PageHeader title={tNav('approvalSteps')} />
      <ApprovalStepsCard
        steps={approvalData.ok ? approvalData.steps : []}
        orderEnforced={approvalData.ok ? approvalData.orderEnforced : false}
        // FR-66: whoever edits the steps sets whether their order binds, the
        // same gate as setApprovalOrderEnforced and its RPC.
        canEnforceOrder={can(perms, 'approval_steps')}
        canEdit={can(perms, 'approval_steps')}
      />
    </div>
  );
}
