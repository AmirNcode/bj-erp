'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { getApproverSignature, getRequestSignature } from '@/lib/actions/leave';
import type { SignatureLabels } from '@/lib/leave/signature';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export type { SignatureLabels } from '@/lib/leave/signature';

type SignatureFieldsProps = {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  authorized: boolean;
  onAuthorizedChange: (value: boolean) => void;
  labels: SignatureLabels;
};

type Point = { x: number; y: number };

const CANVAS_HEIGHT = 160;

/** Mouse, stylus, and touch signature capture through one Pointer Events path. */
export function RequestSignatureFields({
  idPrefix,
  value,
  onChange,
  authorized,
  onAuthorizedChange,
  labels,
}: SignatureFieldsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const strokeDistanceRef = useRef(0);
  const lastExportRef = useRef('');

  const configureContext = useCallback((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) return null;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 2.5;
    context.strokeStyle = '#111827';
    return context;
  }, []);

  const drawStoredValue = useCallback(
    (canvas: HTMLCanvasElement, source: string) => {
      const context = configureContext(canvas);
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
      if (!source) return;

      const image = new Image();
      image.onload = () => {
        context.drawImage(image, 0, 0, canvas.width / ratio, canvas.height / ratio);
      };
      image.src = source;
    },
    [configureContext]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const width = Math.max(1, Math.floor(canvas.getBoundingClientRect().width));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.floor(width * ratio);
      const nextHeight = Math.floor(CANVAS_HEIGHT * ratio);
      if (canvas.width === nextWidth && canvas.height === nextHeight) return;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      drawStoredValue(canvas, value);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [drawStoredValue, value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (value === lastExportRef.current) {
      lastExportRef.current = '';
      return;
    }
    drawStoredValue(canvas, value);
  }, [drawStoredValue, value]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const exportPng = (canvas: HTMLCanvasElement) => {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const context = exportCanvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    context.drawImage(canvas, 0, 0);
    const nextValue = exportCanvas.toDataURL('image/png');
    lastExportRef.current = nextValue;
    onChange(nextValue);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
    strokeDistanceRef.current = 0;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastPointRef.current) return;
    event.preventDefault();
    const context = configureContext(event.currentTarget);
    if (!context) return;

    const next = pointFromEvent(event);
    const previous = lastPointRef.current;
    strokeDistanceRef.current += Math.hypot(next.x - previous.x, next.y - previous.y);
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(next.x, next.y);
    context.stroke();
    lastPointRef.current = next;
  };

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (strokeDistanceRef.current >= 2) exportPng(event.currentTarget);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    }
    onChange('');
  };

  const instructionsId = `${idPrefix}-signature-instructions`;
  const authorizationId = `${idPrefix}-signature-authorization`;

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{labels.title}</legend>
      <p id={instructionsId} className="text-xs text-muted-foreground">
        {labels.instructions}
      </p>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={labels.canvasLabel}
        aria-describedby={instructionsId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        className="h-40 w-full cursor-crosshair rounded-md border border-input bg-white shadow-inner"
        style={{ touchAction: 'none' }}
        data-testid={`${idPrefix}-signature-canvas`}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={clear}
          disabled={!value}
          data-testid={`${idPrefix}-signature-clear`}
        >
          {labels.clear}
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <input
          id={authorizationId}
          type="checkbox"
          checked={authorized}
          onChange={(event) => onAuthorizedChange(event.target.checked)}
          aria-required="true"
          className="mt-0.5 size-4 shrink-0 rounded border-input text-primary focus:ring-ring"
          data-testid={`${idPrefix}-signature-authorized`}
        />
        <Label htmlFor={authorizationId} className="cursor-pointer text-sm font-normal leading-5">
          {labels.authorization}
        </Label>
      </div>
    </fieldset>
  );
}

type SignatureViewerProps = {
  requestId: string;
  consentAt: string | null;
  labels: SignatureLabels;
  locale: string;
  kind?: 'requester' | 'approver';
};

/** Signature timestamps always use the Persian calendar, independent of UI language. */
export function formatPersianConsentTimestamp(value: string, locale: string): string {
  return new Intl.DateTimeFormat(
    locale === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US-u-ca-persian',
    {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    }
  ).format(new Date(value));
}

/** Fetches the private image only when an authorized viewer asks to see it. */
export function RequestSignatureViewer({
  requestId,
  consentAt,
  labels,
  locale,
  kind = 'requester',
}: SignatureViewerProps) {
  const [open, setOpen] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [storedConsentAt, setStoredConsentAt] = useState(consentAt);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  if (!consentAt) return null;

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (signatureData) {
      setOpen(true);
      return;
    }

    setError('');
    startTransition(async () => {
      const result = await (kind === 'approver'
        ? getApproverSignature(requestId)
        : getRequestSignature(requestId));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSignatureData(result.signatureData);
      setStoredConsentAt(result.consentAt);
      setOpen(true);
    });
  };

  const consentLabel = storedConsentAt
    ? `${labels.authorizedAt} ${formatPersianConsentTimestamp(storedConsentAt, locale)}`
    : '';

  const testIdPrefix = kind === 'approver' ? 'approver-signature' : 'signature';

  return (
    <div className="mt-2" data-testid={`${testIdPrefix}-viewer-${requestId}`}>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{labels.title}</p>
      <Button type="button" variant="outline" size="sm" onClick={toggle} disabled={isPending}>
        {isPending ? labels.loading : open ? labels.hide : labels.view}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {open && signatureData && (
        <div
          className="mt-2 max-w-md rounded-lg border border-border bg-white p-2"
          data-testid={`${testIdPrefix}-preview-${requestId}`}
        >
          {/* A private data URL is already encoded and should not pass through the image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={signatureData} alt={labels.title} className="h-auto max-h-40 w-full object-contain" />
          <p className="mt-1 text-xs text-slate-600">{consentLabel}</p>
        </div>
      )}
    </div>
  );
}
