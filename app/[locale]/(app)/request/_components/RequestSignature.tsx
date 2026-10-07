'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { getApproverSignature, getRequestSignature } from '@/lib/actions/leave/signatures';
import type { SignatureLabels } from '@/lib/leave/signature';
import { formatPersianConsentTimestamp } from '@/lib/i18n/format';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useSavedSignature } from '@/lib/signature/useSavedSignature';

export type { SignatureLabels } from '@/lib/leave/signature';

type Point = { x: number; y: number };

const CANVAS_HEIGHT = 160;

type SignatureCanvasProps = {
  /** PNG data URL shown on the canvas ('' = blank). */
  value: string;
  /** Called after each stroke with the canvas exported as PNG. */
  onChange: (value: string) => void;
  label: string;
  describedBy?: string;
  testId: string;
};

/**
 * Mouse, stylus, and touch signature capture through one Pointer Events path.
 * A stored image is drawn aspect-fit, so a saved 3:1 signature (FR-52) is not
 * stretched to the box.
 */
export function SignatureCanvas({ value, onChange, label, describedBy, testId }: SignatureCanvasProps) {
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

  // Bumped on every redraw, so an image that finishes loading after the value
  // changed (e.g. cleared) does not paint itself back.
  const drawTokenRef = useRef(0);

  const drawStoredValue = useCallback(
    (canvas: HTMLCanvasElement, source: string) => {
      const token = ++drawTokenRef.current;
      const context = configureContext(canvas);
      if (!context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      context.clearRect(0, 0, width, height);
      if (!source) return;

      const image = new Image();
      image.onload = () => {
        if (token !== drawTokenRef.current) return;
        const scale = Math.min(width / (image.width || width), height / (image.height || height));
        const w = (image.width || width) * scale;
        const h = (image.height || height) * scale;
        context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
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
    // The value is what the canvas just exported: it already shows it. Only a
    // real export counts; an empty value (Clear) must always wipe the canvas.
    if (value && value === lastExportRef.current) {
      lastExportRef.current = '';
      return;
    }
    lastExportRef.current = '';
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

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={label}
      aria-describedby={describedBy}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
      className="h-40 w-full cursor-crosshair rounded-md border border-input bg-white shadow-inner"
      style={{ touchAction: 'none' }}
      data-testid={testId}
    />
  );
}

type SignatureFieldsProps = {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  authorized: boolean;
  onAuthorizedChange: (value: boolean) => void;
  labels: SignatureLabels;
};

/**
 * A signature box with its per-signing authorization checkbox. When the caller
 * has a saved signature (FR-52) the box opens with it; consent is still asked
 * every time, and clearing it lets them draw a new one for this signing only.
 */
export function RequestSignatureFields({
  idPrefix,
  value,
  onChange,
  authorized,
  onAuthorizedChange,
  labels,
}: SignatureFieldsProps) {
  const saved = useSavedSignature();
  // Set once the person clears the box, so an empty value is not refilled.
  const [declinedSaved, setDeclinedSaved] = useState(false);

  useEffect(() => {
    if (saved && !value && !declinedSaved) onChange(saved);
  }, [saved, value, declinedSaved, onChange]);

  const clear = () => {
    setDeclinedSaved(true);
    onChange('');
  };

  const usingSaved = !!saved && value === saved;
  const instructionsId = `${idPrefix}-signature-instructions`;
  const authorizationId = `${idPrefix}-signature-authorization`;

  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-semibold">{labels.title}</legend>
      <p id={instructionsId} className="text-xs text-muted-foreground">
        {usingSaved ? labels.savedNote : labels.instructions}
      </p>
      <SignatureCanvas
        value={value}
        onChange={onChange}
        label={labels.canvasLabel}
        describedBy={instructionsId}
        testId={`${idPrefix}-signature-canvas`}
      />
      <div className="flex flex-wrap justify-end gap-2">
        {saved && !usingSaved && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(saved)}
            data-testid={`${idPrefix}-signature-use-saved`}
          >
            {labels.useSaved}
          </Button>
        )}
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

/**
 * Signature timestamps always use the Persian calendar, independent of UI
 * language. The implementation moved to lib/i18n/format.ts so Server Components
 * (the printable form, FR-38) can use it without importing this client module;
 * re-exported here because this is where callers and its unit test expect it.
 */
export { formatPersianConsentTimestamp } from '@/lib/i18n/format';

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
