'use client';

/**
 * FR-94 record files, grouped by stage across every flow the record has been in (bid
 * stages first). Upload per group and page-wide (default: the current stage), drag and
 * drop from md up, progress per file. Downloads are plain links to the file route.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatFileSize, groupFilesByStage, recordFlowIds } from '@/lib/sales/files';
import type { Bootstrap, RecordDetail, SalesFile } from '@/lib/sales/types';
import { useViewAs } from '../../_components/ViewAsContext';
import { ConfirmDialog, useSalesFormat } from './parts';
import { FileUploadButton, useFileUploads } from './FileUpload';

export function FilesTab({ boot, detail }: { boot: Bootstrap; detail: RecordDetail }) {
  const t = useTranslations('sales');
  const f = useSalesFormat();
  const router = useRouter();
  const viewing = useViewAs() !== null;
  const r = detail.record;
  const { items, upload, dismiss, busy } = useFileUploads(r.id);
  const [removing, setRemoving] = useState<SalesFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dropOn, setDropOn] = useState<string | null>(null);

  const canWrite = boot.caps.edit && (r.stage_kind === 'open' || boot.caps.decide) && !viewing;
  const flowIds = recordFlowIds(r, detail.events, detail.files, boot.stages);
  const groups = groupFilesByStage(detail.files, boot.stages, flowIds, boot.flows);
  const flowName = (id: string) => { const fl = boot.flows.find((x) => x.id === id); return fl ? (f.locale === 'fa' ? fl.name_fa : fl.name_en) : ''; };
  const size = (bytes: number) => { const s = formatFileSize(bytes); return `${f.number(s.value)} ${t(`files.unit.${s.unit}`)}`; };

  async function remove(file: SalesFile) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/sales/files/${file.id}`, { method: 'DELETE' });
      if (res.ok) { setRemoving(null); router.refresh(); } else toast.error(t(res.status === 403 ? 'files.error.forbidden' : res.status === 404 ? 'files.error.notFound' : 'files.error.failed'));
    } catch {
      toast.error(t('files.error.failed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="sales-files">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{t('files.hint')}</p>
        {canWrite ? <FileUploadButton label={t('files.upload')} disabled={!r.stage_id} onPick={(files) => void upload(r.stage_id, files)} testId="sales-files-upload" /> : null}
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1 border-y border-border py-2 text-sm" data-testid="sales-files-progress">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-3">
              <bdi className="min-w-0 flex-1 truncate">{i.name}</bdi>
              {i.error ? (
                <>
                  <span className="text-destructive">{i.error}</span>
                  <Button size="xs" variant="ghost" onClick={() => dismiss(i.key)}>{t('files.dismiss')}</Button>
                </>
              ) : <span className="tabular-nums text-muted-foreground">{i.done ? '✓' : f.percent(i.percent / 100)}</span>}
            </li>
          ))}
        </ul>
      ) : null}

      {groups.map((g) => {
        const id = g.stage?.id ?? 'other';
        const stageId = g.stage?.id;
        return (
          <section key={id}
            className={`flex flex-col gap-2 ${dropOn === id ? 'outline-2 outline-dashed outline-primary' : ''}`}
            data-testid={`sales-files-group-${g.stage?.code ?? id}`}
            onDragOver={canWrite && stageId ? (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropOn(id); } } : undefined}
            onDragLeave={() => setDropOn((cur) => (cur === id ? null : cur))}
            onDrop={canWrite && stageId ? (e) => {
              e.preventDefault();
              setDropOn(null);
              const dropped = Array.from(e.dataTransfer.files);
              if (dropped.length > 0) void upload(stageId, dropped);
            } : undefined}>
            <div className="flex items-center justify-between gap-3 border-b border-border pb-1">
              <h4 className="text-sm font-semibold">
                {g.stage ? f.stageName(g.stage) : t('files.other')}
                {g.stage && flowIds.length > 1 ? <span className="ms-2 text-xs font-normal text-muted-foreground">{flowName(g.stage.flow_id)}</span> : null}
                <span className="ms-2 text-xs font-normal tabular-nums text-muted-foreground">{f.number(g.files.length)}</span>
              </h4>
              {canWrite && stageId ? <FileUploadButton label={t('files.upload')} onPick={(files) => void upload(stageId, files)} testId={`sales-files-upload-${g.stage?.code ?? id}`} /> : null}
            </div>
            {g.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('files.empty')}{canWrite && stageId ? <span className="max-md:hidden"> · {t('files.drop')}</span> : null}</p>
            ) : (
              <div className="overflow-x-auto border-b border-border">
                <table className="data-table w-full text-sm">
                  <thead>
                    <tr>
                      <th className="text-start">{t('files.name')}</th>
                      <th className="text-start">{t('files.size')}</th>
                      <th className="text-start">{t('files.uploader')}</th>
                      <th className="text-start">{t('files.date')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {g.files.map((file) => (
                      <tr key={file.id} className="whitespace-nowrap" data-testid="sales-file-row">
                        <td className="max-w-72 truncate font-medium"><bdi>{file.name}</bdi></td>
                        <td className="tabular-nums">{size(file.size_bytes)}</td>
                        <td>{file.uploader_name ?? <span className="text-muted-foreground">—</span>}</td>
                        <td>{f.date(file.uploaded_at)}</td>
                        <td className="text-end">
                          <Button size="xs" variant="ghost" asChild>
                            <a href={`/api/sales/files/${file.id}`} download={file.name} data-testid="sales-file-download">{t('files.download')}</a>
                          </Button>
                          {canWrite && file.can_delete ? (
                            <Button size="xs" variant="ghost" className="text-destructive" onClick={() => setRemoving(file)} data-testid="sales-file-delete">{t('remove')}</Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
      {busy ? <span className="sr-only" role="status">{t('files.uploading')}</span> : null}

      {removing ? (
        <ConfirmDialog title={t('files.deleteTitle')} body={t('files.deleteBody', { name: removing.name })}
          confirmLabel={t('remove')} cancelLabel={t('cancel')} pending={deleting}
          onConfirm={() => void remove(removing)} onClose={() => setRemoving(null)} />
      ) : null}
    </div>
  );
}
