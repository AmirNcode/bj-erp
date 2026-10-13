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

  const [tNav, tApproval, tAdd, tSteps] = await Promise.all([
    getTranslations('nav'),
    getTranslations('manage.settings.approvalSteps'),
    getTranslations('manage.settings.approvalSteps.addStep'),
    getTranslations('approvals.steps'),
  ]);
  const approvalData = await getApprovalSteps();

  const approvalLabels = {
    title: tApproval('title'),
    hint: tApproval('hint'),
    orderEnforced: tApproval('orderEnforced'),
    orderHint: tApproval('orderHint'),
    stepOrder: tApproval('stepOrder'),
    active: tApproval('active'),
    saved: tApproval('saved'),
    error: tApproval('error'),
    empty: tApproval('empty'),
    personStep: tApproval('personStep'),
    inactiveApprover: tApproval('inactiveApprover'),
    remove: tApproval('remove'),
    removeConfirm: tApproval('removeConfirm'),
    removed: tApproval('removed'),
    orderAdminOnly: tApproval('orderAdminOnly'),
    departmentHint: tApproval('departmentHint'),
    steps: {
      manager: tSteps('manager'),
      departmentManager: tSteps('departmentManager'),
      hr: tSteps('hr'),
      security: tSteps('security'),
      admin: tSteps('admin'),
      employee: tSteps('employee'),
    },
    addStep: {
      button: tAdd('button'),
      title: tAdd('title'),
      intro: tAdd('intro'),
      kind: tAdd('kind'),
      kindRole: tAdd('kindRole'),
      kindPerson: tAdd('kindPerson'),
      role: tAdd('role'),
      person: tAdd('person'),
      personPlaceholder: tAdd('personPlaceholder'),
      personHint: tAdd('personHint'),
      searching: tAdd('searching'),
      noMatches: tAdd('noMatches'),
      // .raw(): the dialog fills {count}.
      selectOne: tAdd.raw('selectOne'),
      selected: tAdd('selected'),
      clear: tAdd('clear'),
      order: tAdd('order'),
      add: tAdd('add'),
      adding: tAdd('adding'),
      cancel: tAdd('cancel'),
      added: tAdd('added'),
      errorLabel: tAdd('errorLabel'),
      roles: {
        manager: tSteps('manager'),
        hr: tSteps('hr'),
        security: tSteps('security'),
        admin: tSteps('admin'),
        employee: tSteps('employee'),
      },
    },
  };

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
        labels={approvalLabels}
      />
    </div>
  );
}
