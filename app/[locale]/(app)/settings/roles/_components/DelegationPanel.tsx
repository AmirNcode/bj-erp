'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDelegationContext, searchDelegates, setApprovalDelegate, setExecutiveSettings } from '@/lib/actions/approval-delegation';
import type { DelegateCandidate, DelegationContext, ExecutiveSettings } from '@/lib/leave/delegation';

const selectClass = 'min-h-11 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Settings access here does not grant access to role authoring or personnel. */
export function DelegationPanel({ initial, initialCandidates, locale }: {
  initial: DelegationContext; initialCandidates: DelegateCandidate[]; locale: string;
}) {
  const t = useTranslations('rolesDelegation');
  const router = useRouter();
  const [context, setContext] = useState(initial);
  const [candidates, setCandidates] = useState(initialCandidates);
  const [delegateId, setDelegateId] = useState(initial.saved?.delegate_id ?? '');
  const [authorized, setAuthorized] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isPending, startTransition] = useTransition();
  const isCeo = context.principal_id === context.executive_settings.ceo_id;
  const canManage = context.can_delegate && context.can_approve;
  const saved = context.saved;
  const effective = context.effective;
  const savedOutsideResults = !!saved && !candidates.some((p) => p.profile_id === saved.delegate_id);
  const eligibleSelection = !delegateId || candidates.some((p) => p.profile_id === delegateId);

  async function refreshPrincipal(principalId: string) {
    const next = await getDelegationContext(principalId);
    if (!next.ok) { setError(next.error); return; }
    const people = next.context.can_delegate && next.context.can_approve
      ? await searchDelegates(principalId)
      : { ok: true as const, candidates: [] };
    setContext(next.context);
    setDelegateId(next.context.saved?.delegate_id ?? '');
    setAuthorized(false);
    setSearch('');
    setCandidates(people.ok ? people.candidates : []);
    if (!people.ok) setError(people.error);
  }

  const changePrincipal = (principalId: string) => {
    setError(''); setNotice('');
    startTransition(() => refreshPrincipal(principalId));
  };
  const save = () => {
    setError(''); setNotice('');
    startTransition(async () => {
      const result = await setApprovalDelegate({ principalId: context.principal_id, delegateId: delegateId || null, ceoAuthorized: isCeo && authorized });
      if (!result.ok) { setError(result.error); return; }
      await refreshPrincipal(context.principal_id);
      setNotice(t('saved'));
      router.refresh();
    });
  };
  const end = effective?.ends_at
    ? formatPersianConsentTimestamp(effective.ends_at, locale)
    : null;

  return (
    <>
      <Card data-testid="approval-delegation-panel">
        <CardHeader><CardTitle>{context.is_admin ? t('title') : t('myTitle')}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">{t('hint')}</p>
          {context.is_admin && (
            <div className="space-y-2">
              <Label htmlFor="delegate-principal">{t('principal')}</Label>
              <select id="delegate-principal" className={selectClass} value={context.principal_id} disabled={isPending} onChange={(e) => changePrincipal(e.target.value)} data-testid="delegate-principal">
                {!context.principals.some((p) => p.profile_id === context.principal_id) && <option value={context.principal_id}>{context.principal_name}</option>}
                {context.principals.map((p) => <option key={p.profile_id} value={p.profile_id}>{p.full_name} {p.employee_code ? `(${p.employee_code})` : ''}</option>)}
              </select>
            </div>
          )}
          <dl className="grid gap-4 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t('defaultDelegate')}</dt><dd className="mt-1 font-medium"><bdi>{saved?.delegate_name ?? t('none')}</bdi></dd></div>
            <div><dt className="text-muted-foreground">{t('activeDelegate')}</dt><dd className="mt-1 font-medium"><bdi>{effective?.delegate_name ?? t('none')}</bdi></dd>
              {effective?.source_request_id && <dd className="mt-1 text-xs text-muted-foreground">{end ? t('temporaryUntil', { date: end }) : t('temporary')}</dd>}
            </div>
          </dl>
          {effective?.source_request_id && <p className="text-sm text-muted-foreground">{t('fallback', { name: saved?.delegate_name ?? t('none') })}</p>}
          {!canManage && <p className="rounded-lg bg-muted p-3 text-sm" role="note">{t('permissionRequired')}</p>}
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault(); setError('');
            startTransition(async () => {
              const result = await searchDelegates(context.principal_id, search);
              if (!result.ok) { setError(result.error); setCandidates([]); } else setCandidates(result.candidates);
            });
          }}>
            <Label htmlFor="delegate-search">{t('search')}</Label>
            <div className="flex gap-2"><Input id="delegate-search" value={search} onChange={(e) => setSearch(e.target.value)} disabled={isPending || !canManage} autoComplete="off" /><Button type="submit" variant="outline" disabled={isPending || !canManage}>{t('searchButton')}</Button></div>
          </form>
          <div className="space-y-2">
            <Label htmlFor="saved-approval-delegate">{t('selectDelegate')}</Label>
            <select id="saved-approval-delegate" value={delegateId} className={selectClass} disabled={isPending || !canManage} onChange={(e) => { setDelegateId(e.target.value); setAuthorized(false); }} data-testid="saved-approval-delegate">
              <option value="">{t('none')}</option>
              {saved && savedOutsideResults && <option value={saved.delegate_id} disabled>{saved.delegate_name}</option>}
              {candidates.map((p) => <option key={p.profile_id} value={p.profile_id}>{p.full_name} {p.employee_code ? `(${p.employee_code})` : ''}</option>)}
            </select>
            <p className="text-xs text-muted-foreground">{isCeo ? t('ceoEligibility') : t('eligibility')}</p>
          </div>
          {isCeo && delegateId && <label className="flex items-start gap-3 rounded-lg border p-3 text-sm"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} disabled={isPending} className="mt-1 size-4 shrink-0 accent-primary" data-testid="delegate-ceo-attestation" /><span>{t('ceoAttestation')}</span></label>}
          <p className="text-xs text-muted-foreground">{t('retainedAuthority')}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
          <Button onClick={save} disabled={isPending || !canManage || !eligibleSelection || (isCeo && !!delegateId && !authorized)} data-testid="delegate-save">{isPending ? t('saving') : t('save')}</Button>
        </CardContent>
      </Card>
      {context.is_admin && <ExecutiveSettingsPanel key={JSON.stringify(context.executive_settings)} context={context} onSaved={() => refreshPrincipal(context.principal_id)} />}
    </>
  );
}

function ExecutiveSettingsPanel({ context, onSaved }: { context: DelegationContext; onSaved: () => Promise<void> }) {
  const t = useTranslations('rolesDelegation');
  const roleLabels: Record<string, string> = {
    admin: t('stepRoles.admin'), manager: t('stepRoles.manager'), employee: t('stepRoles.employee'),
    hr: t('stepRoles.hr'), security: t('stepRoles.security'), finance: t('stepRoles.finance'),
  };
  const router = useRouter();
  const [settings, setSettings] = useState<ExecutiveSettings>(context.executive_settings);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isPending, startTransition] = useTransition();
  return (
    <Card data-testid="executive-approval-settings"><CardHeader><CardTitle>{t('executiveTitle')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('executiveHint')}</p>
        {(['ceo_id', 'hr_head_id'] as const).map((key) => <div key={key} className="space-y-2"><Label htmlFor={key}>{key === 'ceo_id' ? t('ceo') : t('hrHead')}</Label><select id={key} className={selectClass} value={settings[key] ?? ''} disabled={isPending} onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value || null }))}><option value="">{t('none')}</option>{context.principals.map((p) => <option key={p.profile_id} value={p.profile_id}>{p.full_name} {p.employee_code ? `(${p.employee_code})` : ''}</option>)}</select></div>)}
        <fieldset className="space-y-3"><legend className="mb-2 text-sm font-medium">{t('hrSteps')}</legend>
          <p className="text-xs text-muted-foreground">{t('hrStepsHint')}</p>
          {context.hr_steps.length === 0 && <p className="text-sm">{t('noSteps')}</p>}
          {context.hr_steps.map((step) => <label key={step.step_id} className="flex min-h-11 items-center gap-3 rounded-md border p-3 text-sm"><input type="checkbox" checked={settings.hr_step_ids.includes(step.step_id)} disabled={isPending} className="size-4 accent-primary" onChange={(e) => setSettings((s) => ({ ...s, hr_step_ids: e.target.checked ? [...s.hr_step_ids, step.step_id] : s.hr_step_ids.filter((id) => id !== step.step_id) }))} /><span>{t('step', { order: step.step_order, name: step.expected_name ?? roleLabels[step.step_role] ?? t('none') })}</span></label>)}
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
        <Button disabled={isPending} data-testid="executive-settings-save" onClick={() => { setError(''); setNotice(''); startTransition(async () => { const result = await setExecutiveSettings(settings); if (!result.ok) { setError(result.error); return; } await onSaved(); setNotice(t('saved')); router.refresh(); }); }}>{isPending ? t('saving') : t('saveExecutive')}</Button>
      </CardContent>
    </Card>
  );
}

