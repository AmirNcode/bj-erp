import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RequestSignatureFields,
  RequestSignatureViewer,
  formatPersianConsentTimestamp,
  type SignatureLabels,
} from '@/app/[locale]/(app)/request/_components/RequestSignature';
import { getApproverSignature, getRequestSignature } from '@/lib/actions/leave';
import {
  isValidSignatureData,
  MAX_SIGNATURE_DATA_LENGTH,
  MIN_SIGNATURE_DATA_LENGTH,
} from '@/lib/leave/signature';

vi.mock('@/lib/actions/leave', () => ({
  getApproverSignature: vi.fn(),
  getRequestSignature: vi.fn(),
}));

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lwQG8QAAAABJRU5ErkJggg==';

const labels: SignatureLabels = {
  title: 'Signature',
  instructions: 'Draw here.',
  clear: 'Clear signature',
  authorization: 'I authorize this signature.',
  validationSignature: 'Signature required.',
  validationAuthorization: 'Authorization required.',
  canvasLabel: 'Signature drawing area',
  view: 'View signature',
  hide: 'Hide signature',
  loading: 'Loading signature…',
  authorizedAt: 'Authorization recorded at:',
};

const context = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  lineCap: 'round',
  lineJoin: 'round',
  lineWidth: 1,
  strokeStyle: '',
  fillStyle: '',
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 400,
    height: 160,
    top: 0,
    right: 400,
    bottom: 160,
    left: 0,
    toJSON: () => ({}),
  });
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('request signature data', () => {
  it('accepts a bounded PNG data URL and rejects unsafe or oversized values', () => {
    expect(isValidSignatureData(PNG)).toBe(true);
    expect(isValidSignatureData(PNG.replace('image/png', 'image/svg+xml'))).toBe(false);
    expect(isValidSignatureData(`${PNG}<script>`)).toBe(false);
    expect(
      isValidSignatureData(
        `data:image/png;base64,iVBORw0KGgo${'A'.repeat(
          MIN_SIGNATURE_DATA_LENGTH - 'data:image/png;base64,iVBORw0KGgo'.length - 1
        )}`
      )
    ).toBe(false);
    expect(
      isValidSignatureData(
        `data:image/png;base64,iVBORw0KGgo${'A'.repeat(MAX_SIGNATURE_DATA_LENGTH)}`
      )
    ).toBe(false);
  });
});

describe('RequestSignatureFields', () => {
  it('captures pointer strokes and requires an explicit authorization checkbox', () => {
    const onChange = vi.fn();
    const onAuthorizedChange = vi.fn();
    render(
      <RequestSignatureFields
        idPrefix="daily"
        value=""
        onChange={onChange}
        authorized={false}
        onAuthorizedChange={onAuthorizedChange}
        labels={labels}
      />
    );

    const canvas = screen.getByTestId('daily-signature-canvas');
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 60 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 80, clientY: 60 });

    expect(onChange).toHaveBeenCalledWith(PNG);
    fireEvent.click(screen.getByRole('checkbox', { name: labels.authorization }));
    expect(onAuthorizedChange).toHaveBeenCalledWith(true);
  });
});

describe('RequestSignatureViewer', () => {
  it('fetches the private PNG only when the viewer opens it', async () => {
    vi.mocked(getRequestSignature).mockResolvedValue({
      ok: true,
      signatureData: PNG,
      consentAt: '2026-08-05T12:00:00.000Z',
    });

    render(
      <RequestSignatureViewer
        requestId="request-1"
        consentAt="2026-08-05T12:00:00.000Z"
        labels={labels}
        locale="en"
      />
    );

    expect(getRequestSignature).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: labels.view }));

    await waitFor(() => {
      expect(getRequestSignature).toHaveBeenCalledWith('request-1');
      expect(screen.getByTestId('signature-preview-request-1')).toBeTruthy();
    });
  });

  it('loads approver evidence separately and formats its timestamp in the Persian calendar', async () => {
    vi.mocked(getApproverSignature).mockResolvedValue({
      ok: true,
      signatureData: PNG,
      consentAt: '2026-08-05T12:00:00.000Z',
    });

    render(
      <RequestSignatureViewer
        requestId="request-2"
        consentAt="2026-08-05T12:00:00.000Z"
        labels={{ ...labels, title: 'Approver signature' }}
        locale="en"
        kind="approver"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: labels.view }));
    await waitFor(() => {
      expect(getApproverSignature).toHaveBeenCalledWith('request-2');
      expect(screen.getByTestId('approver-signature-preview-request-2')).toBeTruthy();
    });
    expect(formatPersianConsentTimestamp('2026-08-05T12:00:00.000Z', 'en')).toContain('1405');
  });
});

describe('daily date fields and database enforcement', () => {
  it('uses two daily pickers while hourly and errand remain single-date forms', () => {
    const daily = readFileSync('app/[locale]/(app)/request/LeaveRequestForm.tsx', 'utf8');
    const hourly = readFileSync(
      'app/[locale]/(app)/request/hourly/HourlyRequestForm.tsx',
      'utf8'
    );
    const errand = readFileSync(
      'app/[locale]/(app)/request/errand/ErrandRequestForm.tsx',
      'utf8'
    );

    expect(daily).toContain('data-testid="daily-start-date"');
    expect(daily).toContain('data-testid="daily-end-date"');
    expect(daily).toContain('minDate={startDate ?? undefined}');
    expect(daily).not.toMatch(/\n\s+range(?:\s|=)/);
    expect(hourly.match(/<LazyDatePicker/g)).toHaveLength(1);
    expect(errand.match(/<LazyDatePicker/g)).toHaveLength(1);
  });

  it('requires signature evidence in every database submission wrapper', () => {
    const sql = readFileSync(
      'supabase/migrations/20260805171924_request_signatures.sql',
      'utf8'
    );

    expect(sql).toContain('leave_requests_signature_shape');
    expect(sql).toContain('signature_consent_at = now()');
    expect(sql.match(/perform private\.attach_request_signature/g)).toHaveLength(3);
    expect(sql).not.toMatch(/(?:create|replace|alter|drop)\s+(?:or\s+replace\s+)?view\s+public\.team_leave_calendar/i);
  });

  it('removes unsigned approvals and Gregorian calendar preferences', () => {
    const sql = readFileSync(
      'supabase/migrations/20260805185628_approval_signatures_persian_only.sql',
      'utf8'
    );
    const queue = readFileSync(
      'app/[locale]/(app)/manage/approvals/ApprovalQueue.tsx',
      'utf8'
    );
    const settings = readFileSync(
      'app/[locale]/(app)/profile/SettingsForm.tsx',
      'utf8'
    );

    expect(sql).toContain('drop function if exists public.approve_leave_request(uuid)');
    expect(sql).toContain('approver_signature_consent_at = v_consent_at');
    expect(sql).toContain('p_signature_authorized boolean');
    expect(sql).toContain("status in ('approved', 'cancelled')");
    expect(sql).toContain("check (calendar_pref = 'jalali')");
    expect(queue).toContain('<RequestSignatureFields');
    expect(queue).toContain('formatCalendarDate(req.start_date, locale)');
    expect(settings).not.toContain('settings-calendar');
    expect(settings).not.toContain('gregorian');
  });
});
