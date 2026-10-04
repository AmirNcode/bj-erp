import { useEffect, useState, useTransition } from 'react';
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
