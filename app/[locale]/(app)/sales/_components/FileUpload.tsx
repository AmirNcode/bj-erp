'use client';

/**
 * FR-94 record files: browser-side upload. One XMLHttpRequest per file (raw body POST to
 * /api/sales/files, headers per the route) so progress is real; errors are per file.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_UPLOAD_BYTES } from '@/lib/sales/files';

export type UploadItem = { key: number; name: string; stageId: string; percent: number; error: string | null; done: boolean };

const STATUS_KEY: Record<number, 'unauthorized' | 'forbidden' | 'notFound' | 'length' | 'tooLarge' | 'invalid'> = {
  401: 'unauthorized', 403: 'forbidden', 404: 'notFound', 411: 'length', 413: 'tooLarge', 400: 'invalid',
};

function send(rfpId: string, stageId: string, file: File, onProgress: (percent: number) => void): Promise<number> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sales/files?rfp=${encodeURIComponent(rfpId)}&stage=${encodeURIComponent(stageId)}`);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-File-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => resolve(0);
    xhr.send(file);
  });
}

/** Upload state for one record. `onFinished` runs once every file of a batch has settled. */
export function useFileUploads(rfpId: string) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const seq = useRef(0);

  const patch = useCallback((key: number, change: Partial<UploadItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...change } : i)));
  }, []);

  const upload = useCallback(async (stageId: string, files: File[]) => {
    const batch = files.map((file) => ({ file, key: ++seq.current }));
    setItems((prev) => [
      ...prev.filter((i) => !i.done || i.error),
      ...batch.map(({ file, key }) => ({ key, name: file.name, stageId, percent: 0, error: null, done: false })),
    ]);
    await Promise.all(batch.map(async ({ file, key }) => {
      if (file.size < 1) return patch(key, { done: true, error: t('files.error.empty') });
      if (file.size > MAX_UPLOAD_BYTES) return patch(key, { done: true, error: t('files.error.tooLarge') });
      const status = await send(rfpId, stageId, file, (percent) => patch(key, { percent }));
      if (status === 201) patch(key, { done: true, percent: 100 });
      else patch(key, { done: true, error: t(`files.error.${STATUS_KEY[status] ?? 'failed'}` as 'files.error.failed') });
    }));
    router.refresh();
    // Successful rows disappear once the refreshed list shows them.
    setItems((prev) => prev.filter((i) => !(i.done && !i.error)));
  }, [patch, router, rfpId, t]);

  const dismiss = useCallback((key: number) => setItems((prev) => prev.filter((i) => i.key !== key)), []);
  return { items, upload, dismiss, busy: items.some((i) => !i.done) };
}

/** A button that opens the file picker (several files) and hands the choice to `onPick`. */
export function FileUploadButton({ label, onPick, disabled, testId }: {
  label: string; onPick: (files: File[]) => void; disabled?: boolean; testId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length > 0) onPick(picked);
        }} />
      <Button type="button" size="sm" variant="outline" className="max-sm:h-11" disabled={disabled} onClick={() => input.current?.click()} data-testid={testId}>
        <Upload aria-hidden="true" /> {label}
      </Button>
    </>
  );
}
