'use client';

/**
 * Profile › Saved signature (FR-52). Draw it or upload a photo; either way it is
 * cropped to the ink, fitted to a 3:1 box and compressed (lib/signature/process)
 * before it is saved, and the person sees that result before saving.
 */

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { deleteMySignature, saveMySignature, type SavedSignature } from '@/lib/actions/signature';
import { loadImageFile, processSignature, type ProcessResult } from '@/lib/signature/process';
import { clearSavedSignatureCache } from '@/lib/signature/useSavedSignature';
import { SignatureCanvas } from '../request/_components/RequestSignature';
import { Button } from '@/components/ui/button';

type Mode =
  | { kind: 'view' }
  | { kind: 'draw'; drawing: string }
  | { kind: 'preview'; dataUrl: string; source: 'drawn' | 'upload' };

function loadDataUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('unsupported image'));
    image.src = src;
  });
}

export function SavedSignatureCard({ initial }: { initial: SavedSignature | null }) {
  const t = useTranslations('profile.signature');
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const problem = (res: Exclude<ProcessResult, { ok: true }>) =>
    res.reason === 'empty' ? t('errorEmpty') : res.reason === 'tooLarge' ? t('errorTooLarge') : t('errorUnsupported');

  const showProcessed = (res: ProcessResult, source: 'drawn' | 'upload') => {
    if (res.ok) setMode({ kind: 'preview', dataUrl: res.dataUrl, source });
    else setError(problem(res));
  };

  const finishDrawing = async (drawing: string) => {
    setError('');
    try {
      const image = await loadDataUrl(drawing);
      showProcessed(processSignature(image, image.naturalWidth, image.naturalHeight), 'drawn');
    } catch {
      setError(t('errorUnsupported'));
    }
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    try {
      const image = await loadImageFile(file);
      showProcessed(processSignature(image, image.naturalWidth, image.naturalHeight), 'upload');
    } catch {
      setError(t('errorUnsupported'));
    }
  };

  const save = (dataUrl: string, source: 'drawn' | 'upload') =>
    startTransition(async () => {
      const res = await saveMySignature({ signatureData: dataUrl, source });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      clearSavedSignatureCache();
      setMode({ kind: 'view' });
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const res = await deleteMySignature();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      clearSavedSignatureCache();
      setConfirmDelete(false);
      router.refresh();
    });

  return (
    <div className="space-y-3" data-testid="saved-signature-card">
      <p className="text-sm text-muted-foreground">{t('hint')}</p>

      {mode.kind === 'view' && (
        <>
          {initial ? (
            <div className="rounded-lg border border-border bg-white p-2">
              {/* A private data URL; nothing for the image optimizer to do. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={initial.signatureData}
                alt={t('title')}
                className="mx-auto h-auto max-h-32 w-full object-contain"
                data-testid="saved-signature-image"
              />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground" data-testid="saved-signature-none">
              {t('none')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => setMode({ kind: 'draw', drawing: '' })} data-testid="saved-signature-draw">
              {t('draw')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} data-testid="saved-signature-upload">
              {t('upload')}
            </Button>
            {initial && !confirmDelete && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} data-testid="saved-signature-delete">
                {t('delete')}
              </Button>
            )}
            {initial && confirmDelete && (
              <>
                <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={isPending} data-testid="saved-signature-delete-confirm">
                  {t('deleteConfirm')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  {t('cancel')}
                </Button>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onFile}
            data-testid="saved-signature-file"
          />
        </>
      )}

      {mode.kind === 'draw' && (
        <>
          <p className="text-xs text-muted-foreground">{t('drawHint')}</p>
          <SignatureCanvas
            value={mode.drawing}
            onChange={(drawing) => setMode({ kind: 'draw', drawing })}
            label={t('canvasLabel')}
            testId="saved-signature-canvas"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!mode.drawing}
              onClick={() => finishDrawing(mode.drawing)}
              data-testid="saved-signature-draw-done"
            >
              {t('next')}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!mode.drawing} onClick={() => setMode({ kind: 'draw', drawing: '' })}>
              {t('clear')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode({ kind: 'view' })}>
              {t('cancel')}
            </Button>
          </div>
        </>
      )}

      {mode.kind === 'preview' && (
        <>
          <p className="text-xs text-muted-foreground">{t('previewHint')}</p>
          <div className="rounded-lg border border-border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mode.dataUrl} alt={t('title')} className="mx-auto h-auto max-h-32 w-full object-contain" data-testid="saved-signature-preview" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => save(mode.dataUrl, mode.source)}
              disabled={isPending}
              data-testid="saved-signature-save"
            >
              {t('save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode({ kind: 'view' })}>
              {t('cancel')}
            </Button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive" data-testid="saved-signature-error">
          {error}
        </p>
      )}
    </div>
  );
}
