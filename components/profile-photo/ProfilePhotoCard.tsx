'use client';

/**
 * Profile photo editor (FR-82). Used on Profile (mode `self`) and on Manage › Employees › Edit
 * employee (mode `hr`, which adds the Lock switch).
 *
 * Pick a file (phones offer the camera too) → it is scaled down to ≤ 2048 px for the cropper →
 * square crop → 256×256 JPEG ≤ 60 KB (lib/photo/process). The original never leaves the device.
 */

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { CropperProps } from 'react-easy-crop';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PersonAvatar } from '@/components/PersonAvatar';
import { removeProfilePhoto, setProfilePhoto, setProfilePhotoLock, type PhotoInfo } from '@/lib/actions/photo';
import { notePhotoVersion } from '@/lib/photo/usePhotoVersion';
import { cropToJpeg, prepareForCrop, type Area, type PhotoProblem } from '@/lib/photo/process';

// Loaded only when the crop dialog opens, so it stays out of the main bundle.
// next/dynamic drops the class's defaultProps from the type, so every prop would look required.
type RequiredCropProps = 'image' | 'crop' | 'zoom' | 'aspect' | 'onCropChange' | 'onZoomChange' | 'onCropComplete';
const Cropper = dynamic(() => import('react-easy-crop'), { ssr: false }) as unknown as ComponentType<
  Pick<CropperProps, RequiredCropProps> & Partial<Omit<CropperProps, RequiredCropProps>>
>;

type Props = {
  employeeId: string;
  name: string;
  initial: PhotoInfo | null;
  mode: 'self' | 'hr';
};

export function ProfilePhotoCard({ employeeId, name, initial, mode }: Props) {
  const t = useTranslations('profile.photo');
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<PhotoInfo | null>(initial);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [lockNew, setLockNew] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Local state is the truth after each save; router.refresh() only updates the rest of the page.
  // Free the downscaled preview when the dialog closes or a new one replaces it.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const lockedForMe = mode === 'self' && !!photo?.locked;
  const problem = (reason: PhotoProblem) =>
    reason === 'tooBig' ? t('errorTooBig') : reason === 'tooLarge' ? t('errorTooLarge') : t('errorUnsupported');

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    const res = await prepareForCrop(file);
    setBusy(false);
    if (!res.ok) {
      setError(problem(res.reason));
      return;
    }
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setArea(null);
    setLockNew(photo?.locked ?? true);
    setPreview(res.value.url);
  };

  const closeCrop = () => setPreview(null);

  const save = () => {
    if (!preview || !area) return;
    setError('');
    startTransition(async () => {
      const out = await cropToJpeg(preview, area);
      if (!out.ok) {
        setError(problem(out.reason));
        return;
      }
      const res = await setProfilePhoto({
        employeeId,
        photoData: out.value,
        ...(mode === 'hr' ? { locked: lockNew } : {}),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhoto({ version: res.version, locked: mode === 'hr' ? lockNew : (photo?.locked ?? false) });
      notePhotoVersion(employeeId, res.version);
      setPreview(null);
      router.refresh();
    });
  };

  const remove = () =>
    startTransition(async () => {
      const res = await removeProfilePhoto(employeeId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPhoto(null);
      notePhotoVersion(employeeId, null);
      setConfirmRemove(false);
      router.refresh();
    });

  const toggleLock = (locked: boolean) =>
    startTransition(async () => {
      setError('');
      const res = await setProfilePhotoLock({ employeeId, locked });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (photo) notePhotoVersion(employeeId, photo.version + 1);
      setPhoto((p) => (p ? { version: p.version + 1, locked } : p));
      router.refresh();
    });

  return (
    <div className="flex items-start gap-4" data-testid="profile-photo-card">
      <PersonAvatar id={employeeId} name={name} version={photo?.version ?? null} size="xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-semibold">{t('title')}</p>
        {lockedForMe ? (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground" data-testid="profile-photo-locked">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {t('lockedByHr')}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{mode === 'self' ? t('hintSelf') : t('hintHr')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={busy || isPending}
                data-testid="profile-photo-change"
              >
                {busy ? t('reading') : photo ? t('change') : t('add')}
              </Button>
              {photo && !confirmRemove && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmRemove(true)}
                  data-testid="profile-photo-remove"
                >
                  {t('remove')}
                </Button>
              )}
              {photo && confirmRemove && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={remove}
                    disabled={isPending}
                    data-testid="profile-photo-remove-confirm"
                  >
                    {t('removeConfirm')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                    {t('cancel')}
                  </Button>
                </>
              )}
            </div>
            {mode === 'hr' && photo && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={photo.locked}
                  disabled={isPending}
                  onChange={(e) => toggleLock(e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  data-testid="profile-photo-lock"
                />
                <span>
                  <span className="block">{t('lock')}</span>
                  <span className="block text-xs text-muted-foreground">{t('lockHint')}</span>
                </span>
              </label>
            )}
          </>
        )}
        {error && !preview && (
          <p role="alert" className="text-sm text-destructive" data-testid="profile-photo-error">
            {error}
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFile}
          data-testid="profile-photo-file"
        />
      </div>

      <Dialog open={!!preview} onOpenChange={(open) => !open && closeCrop()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('cropTitle')}</DialogTitle>
            <DialogDescription>{t('cropHint')}</DialogDescription>
          </DialogHeader>
          {/* The cropper fills its parent absolutely: the box needs a fixed size. */}
          <div className="relative h-72 w-full overflow-hidden rounded-lg bg-black" dir="ltr">
            {preview && (
              <Cropper
                image={preview}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                minZoom={1}
                maxZoom={4}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, px) => setArea(px)}
              />
            )}
          </div>
          <label className="flex items-center gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">{t('zoom')}</span>
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-primary"
              data-testid="profile-photo-zoom"
            />
          </label>
          {mode === 'hr' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={lockNew}
                onChange={(e) => setLockNew(e.target.checked)}
                className="size-4 accent-primary"
                data-testid="profile-photo-lock-new"
              />
              {t('lock')}
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={closeCrop}>
              {t('cancel')}
            </Button>
            <Button type="button" onClick={save} disabled={!area || isPending} data-testid="profile-photo-save">
              {isPending ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
