'use client';

/**
 * The role editor (FR-55, spec "Settings › Roles"): name, one collapsible card
 * per catalog section, the admin-only card, and a sticky save bar.
 *
 * PermissionSection applies every toggle and bulk choice (dependencies
 * included) and hands back the new set plus the items it raised or lowered on
 * its own. This component keeps a note on each of those rows until the next
 * save. The note names the item that caused it: for a row toggle that is the
 * row; for a bulk choice it is the changed item whose dependency explains the
 * note (see mergeNotes).
 */

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { saveRole } from '@/lib/actions/roles';
import type { RoleRow } from '@/lib/actions/roles-helpers';
import {
  DEPENDENCIES,
  SECTIONS,
  sensitivePermissions,
  type Perms,
  type PermKey,
  type SectionChoice,
  type SectionKey,
} from '@/lib/permissions/catalog';
import { cn } from '@/lib/utils';
import { AdminOnlyCard } from './AdminOnlyCard';
import { PermissionSection, type PermNote } from './PermissionSection';

/** Same rule as app_save_role (D11): English, 1–40 characters. */
export const ROLE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 &/-]{0,39}$/;

type Notes = Partial<Record<PermKey, PermNote>>;

/** Whether `from` needs `to`, directly or through other items (D6, any level). */
function needsPath(from: PermKey, to: PermKey): boolean {
  const seen = new Set<PermKey>([from]);
  const queue: PermKey[] = [from];
  while (queue.length) {
    const k = queue.shift()!;
    for (const d of DEPENDENCIES) {
      if (d.key !== k || seen.has(d.needs)) continue;
      if (d.needs === to) return true;
      seen.add(d.needs);
      queue.push(d.needs);
    }
  }
  return false;
}

/**
 * The notes after one PermissionSection change. The cause (`by`) is one of the
 * section's items whose level the user changed (not one raised or lowered for
 * it): for a raised row, the first changed item that needs it; for a lowered
 * row, the first changed item it needs. With no such path (it cannot happen
 * through PermissionSection), the first changed item. Rows the user set
 * themselves lose any older note.
 */
export function mergeNotes(
  notes: Notes,
  section: SectionKey,
  before: Perms,
  after: Perms,
  raised: PermKey[],
  lowered: PermKey[]
): Notes {
  const items = SECTIONS.find((s) => s.key === section)!.items;
  const side = new Set<PermKey>([...raised, ...lowered]);
  const chosen = items.filter((k) => before[k] !== after[k] && !side.has(k));
  const next: Notes = { ...notes };
  for (const k of chosen) delete next[k];
  if (!chosen[0]) return next;
  for (const k of raised) next[k] = { kind: 'raised', by: chosen.find((c) => needsPath(c, k)) ?? chosen[0] };
  for (const k of lowered) next[k] = { kind: 'lowered', by: chosen.find((c) => needsPath(k, c)) ?? chosen[0] };
  return next;
}

export function RoleEditor({ role, locale }: { role: RoleRow | null; locale: string }) {
  const t = useTranslations('rolesAdmin');
  const tp = useTranslations('permissions');
  const router = useRouter();
  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState<Perms>(role?.permissions ?? {});
  const [notes, setNotes] = useState<Notes>({});
  const [dirty, setDirty] = useState(false);
  const [nameError, setNameError] = useState('');
  const [error, setError] = useState('');
  const [confirmSensitive, setConfirmSensitive] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isPreset = role?.kind === 'preset';
  const listHref = `/${locale}/settings/roles`;
  const sensitive = sensitivePermissions(perms);

  // Placeholder-free objects, read whole; the two {item} messages go through t().
  const labels = useMemo(() => {
    const sections = tp.raw('sections') as Record<SectionKey, string>;
    return {
      sections,
      section: {
        items: tp.raw('items') as Record<PermKey, { label: string; description: string }>,
        levels: tp.raw('levels') as { edit: string; read: string; none: string; noRead: string; noEdit: string; yes: string; no: string },
        summary: tp.raw('summary') as Record<SectionChoice, string>,
        raisedBy: (item: string) => tp('raisedBy', { item }),
        loweredBy: (item: string) => tp('loweredBy', { item }),
        sensitive: tp('sensitive'),
      },
    };
  }, [tp]);

  // Leaving the page (reload, close, typed URL) with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // In-app links (side panel, bottom bar, the General|Roles tabs) navigate on the
  // client, so beforeunload never fires: ask on the click instead. Capture phase on
  // the document runs before React's listeners, so a No stops next/link outright.
  // Links that open a new tab or window leave the editor in place and pass.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      if (window.confirm(t('unsaved'))) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirty, t]);

  const onSectionChange =
    (section: SectionKey) => (next: Perms, raised: PermKey[], lowered: PermKey[]) => {
      setNotes((n) => mergeNotes(n, section, perms, next, raised, lowered));
      setPerms(next);
      setDirty(true);
    };

  const cancel = () => {
    if (dirty && !window.confirm(t('unsaved'))) return;
    router.push(listHref);
  };

  const save = (confirmed = false) => {
    setError('');
    setNameError('');
    const trimmed = name.trim();
    if (!isPreset && !ROLE_NAME_RE.test(trimmed)) {
      setNameError(t('nameInvalid'));
      return;
    }
    if (!confirmed && sensitive.length > 0) {
      setConfirmSensitive(true);
      return;
    }
    setConfirmSensitive(false);
    startTransition(async () => {
      const result = await saveRole({ id: role?.id ?? null, name: trimmed, permissions: perms });
      if (!result.ok) {
        if (result.field === 'role_name') setNameError(result.error);
        else setError(result.error);
        toast.error(`${t('errorLabel')}: ${result.error}`);
        return;
      }
      toast.success(t('saved'));
      setNotes({});
      setDirty(false);
      if (!role) router.replace(`${listHref}/${result.id}`);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="role-editor">
      <div className="space-y-1.5">
        <Label htmlFor="role-name">{t('nameLabel')}</Label>
        <Input
          id="role-name"
          dir="ltr"
          value={name}
          maxLength={40}
          disabled={isPreset || isPending}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby="role-name-hint"
          className="h-10 max-w-sm"
          data-testid="role-name"
          onChange={(e) => {
            setName(e.target.value);
            setNameError('');
            setDirty(true);
          }}
        />
        <p id="role-name-hint" className="text-xs text-muted-foreground">
          {isPreset ? t('nameLocked') : t('nameHint')}
        </p>
        {nameError && (
          <p role="alert" className="text-sm text-destructive" data-testid="role-name-error">
            {nameError}
          </p>
        )}
      </div>

      {SECTIONS.map((s, i) => (
        <PermissionSection
          key={s.key}
          section={s.key}
          perms={perms}
          onChange={onSectionChange(s.key)}
          notes={notes}
          defaultOpen={i === 0}
          t={{ title: labels.sections[s.key], ...labels.section }}
        />
      ))}

      <AdminOnlyCard />

      <AlertDialog open={confirmSensitive} onOpenChange={setConfirmSensitive}>
        <AlertDialogContent className="z-[51] max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('sensitiveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('sensitiveDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-64 list-disc space-y-2 overflow-y-auto ps-5 text-sm" data-testid="sensitive-permissions">
            {sensitive.map((key) => (
              <li key={key}>
                <span className="font-medium">{labels.section.items[key].label}</span>
                <p className="text-muted-foreground">{labels.section.items[key].description}</p>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="sensitive-cancel">{t('cancel')}</AlertDialogCancel>
            <Button onClick={() => save(true)} disabled={isPending} data-testid="sensitive-confirm">{t('sensitiveProceed')}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="role-save-error">
          {t('errorLabel')}: {error}
        </p>
      )}

      {/* Sticky above the mobile bottom bar (4rem + its border), at the bottom on desktop. */}
      <div
        className={cn(
          'sticky z-30 -mx-4 flex justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur',
          'bottom-[calc(4rem_+_1px_+_env(safe-area-inset-bottom))] md:bottom-0'
        )}
      >
        <Button variant="outline" className="h-10" disabled={isPending} onClick={cancel} data-testid="role-cancel">
          {t('cancel')}
        </Button>
        {/* An existing role saves only a change: an unchanged save would write an empty audit row. */}
        <Button className="h-10" disabled={isPending || (!!role && !dirty)} onClick={() => save()} data-testid="role-save">
          {isPending ? t('saving') : t('save')}
        </Button>
      </div>
    </div>
  );
}
