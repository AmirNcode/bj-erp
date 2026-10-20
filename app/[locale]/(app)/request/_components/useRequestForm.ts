import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { getRequestDelegationPreview } from '@/lib/actions/leave/delegation';
import type { DelegationPreviewQuery, RequestDelegationPreview } from '@/lib/leave/delegation';
import type { Json } from '@/lib/supabase/types';
import { useRouter } from 'next/navigation';
import { getMyBalance } from '@/lib/actions/leave/balances';
import { getReplacementCandidates } from '@/lib/actions/leave/requests';
import { projectLeaveBalance } from '@/lib/leave/duration';
import type { ReplacementCandidate } from '@/lib/leave/replacement';
import type { SignatureLabels } from './RequestSignature';

/**
 * Hooks shared by the four request forms. Fetching hooks set state only inside
 * their async callbacks (the repo lints against synchronous setState in an
 * effect), and "loading" is derived from which input the last fetch was for.
 */

/** Runs a submit: clears messages, refuses on `problem`, else sends and refreshes. */
export function useRequestSubmit(successText: string) {
  const router = useRouter();
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function submit(
    problem: string | null,
    send: () => Promise<{ ok: true } | { ok: false; error: string }>,
    onSuccess: () => void
  ) {
    setError('');
    setSuccess('');
    if (problem) {
      setError(problem);
      return;
    }
    startTransition(async () => {
      const result = await send();
      if (result.ok) {
        setSuccess(successText);
        onSuccess();
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return { success, error, isPending, submit };
}

/** State for `RequestSignatureFields`, plus the validation every form runs. */
export function useSignature() {
  const [data, setData] = useState('');
  const [authorized, setAuthorized] = useState(false);

  return {
    fieldProps: {
      value: data,
      onChange: setData,
      authorized,
      onAuthorizedChange: setAuthorized,
    },
    data,
    authorized,
    problem: (labels: SignatureLabels) =>
      !data ? labels.validationSignature : !authorized ? labels.validationAuthorization : null,
    reset: () => {
      setData('');
      setAuthorized(false);
    },
  };
}

/** The caller's balance for the chosen leave type, and what this request leaves of it. */
export function useLeaveBalance(leaveTypeId: string, requestedMinutes: number | null) {
  const [fetched, setFetched] = useState<{ typeId: string; minutes: number | null } | null>(null);

  useEffect(() => {
    if (!leaveTypeId) return;
    let cancelled = false;
    getMyBalance(leaveTypeId).then((res) => {
      if (!cancelled) setFetched({ typeId: leaveTypeId, minutes: res.ok ? res.balanceMinutes : null });
    });
    return () => {
      cancelled = true;
    };
  }, [leaveTypeId]);

  const current = fetched && fetched.typeId === leaveTypeId ? fetched.minutes : null;
  return {
    loading: !!leaveTypeId && fetched?.typeId !== leaveTypeId,
    projection:
      requestedMinutes !== null && current !== null
        ? projectLeaveBalance(requestedMinutes, current)
        : null,
  };
}

type CandidateQuery = Parameters<typeof getReplacementCandidates>[0];

/**
 * Replacement candidates for the requested period. Availability depends on the
 * period, so the list is re-fetched when it changes and a pick that is no longer
 * available is dropped.
 */
export function useReplacementCandidates(query: CandidateQuery | null) {
  const key = query ? JSON.stringify(query) : '';
  const [fetched, setFetched] = useState<{ key: string; list: ReplacementCandidate[] } | null>(
    null
  );
  const [replacementId, setReplacementId] = useState('');
  const [noReplacement, setNoReplacement] = useState(false);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    getReplacementCandidates(JSON.parse(key) as CandidateQuery).then((res) => {
      if (cancelled) return;
      const list = res.ok ? res.candidates : [];
      setFetched({ key, list });
      setReplacementId((current) =>
        current && list.some((c) => c.profileId === current && !c.unavailable) ? current : ''
      );
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const ready = !!key && fetched !== null && fetched.key === key;
  return {
    candidates: ready && fetched ? fetched.list : [],
    loading: !!key && !ready,
    replacementId,
    setReplacementId,
    noReplacement,
    setNoReplacement,
    reset: () => {
      setReplacementId('');
      setNoReplacement(false);
    },
  };
}

/** Preview/consent is bound to the exact inputs and server authority version. */
export function useRequestDelegation(query: DelegationPreviewQuery | null) {
  const t = useTranslations('delegation');
  const key = query ? JSON.stringify(query) : '';
  const [revision, setRevision] = useState(0);
  const [inputVersion, setInputVersion] = useState({ key, version: 0 });
  // A→B→A (including clearing dates) is a new preview, even if A's earlier result is cached in state.
  if (inputVersion.key !== key) setInputVersion({ key, version: inputVersion.version + 1 });
  const fetchKey = `${key}:${revision}:${inputVersion.version}`;
  const [fetched, setFetched] = useState<{
    key: string; preview: RequestDelegationPreview | null; error: string;
  } | null>(null);
  const [ownConsent, setOwnConsent] = useState('');
  const [temporaryConsent, setTemporaryConsent] = useState('');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    getRequestDelegationPreview(JSON.parse(key) as DelegationPreviewQuery).then((result) => {
      if (cancelled) return;
      setFetched(result.ok
        ? { key: fetchKey, preview: result.preview, error: '' }
        : { key: fetchKey, preview: null, error: result.error });
      // An A→B→A edit still needs a fresh acceptance when the original inputs return.
      setOwnConsent('');
      setTemporaryConsent('');
    }).catch(() => {
      if (!cancelled) {
        setFetched({ key: fetchKey, preview: null, error: t('previewFailed') });
        setOwnConsent('');
        setTemporaryConsent('');
      }
    });
    return () => { cancelled = true; };
  }, [key, fetchKey, t]);

  const ready = !!key && fetched?.key === fetchKey;
  const preview = ready ? fetched.preview : null;
  const consentKey = preview ? `${fetchKey}:${preview.preview_token}:${preview.authority_id ?? ''}` : '';
  const autoApprovalConsent = !!consentKey && ownConsent === consentKey;
  const temporaryCeoAuthorized = !!consentKey && temporaryConsent === consentKey;
  const error = ready ? fetched.error : '';
  const loading = !!key && !ready;
  const problem = () => !preview
    ? error || t('previewRequired')
    : preview.auto_approval_eligible && !autoApprovalConsent
      ? t('ownConsentRequired')
      : preview.is_ceo && preview.temporary_eligible && !temporaryCeoAuthorized
        ? t('temporaryConsentRequired')
        : null;

  return {
    /** The absence these results describe; the form also derives the return-to-work day from it. */
    query,
    preview, loading, error,
    blocked: !!key && problem() !== null,
    autoApprovalConsent,
    temporaryCeoAuthorized,
    setAutoApprovalConsent: (checked: boolean) => setOwnConsent(checked ? consentKey : ''),
    setTemporaryCeoAuthorized: (checked: boolean) => setTemporaryConsent(checked ? consentKey : ''),
    refresh: () => setRevision((r) => r + 1),
    problem,
    submission: {
      delegationPreview: preview as unknown as Json | null,
      autoApprovalConsent,
      temporaryCeoAuthorized,
    },
  };
}
