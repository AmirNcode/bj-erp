/**
 * FR-88 on Home: requests waiting for the caller's signature as replacement, and the
 * caller's own requests whose replacement declined (choose someone else or nobody).
 * Streams on its own; renders nothing when nothing waits.
 */

import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMyReplacementRequests } from '@/lib/actions/leave/replacement';
import { getMyLeaveRequests } from '@/lib/actions/leave/requests';
import { getWorkSettings } from '@/lib/actions/leave/reference';
import { getApprovalCapabilities } from '@/lib/auth/approval-capabilities';
import { formatCalendarDate } from '@/lib/leave/calendarMonth';
import { WORK_SETTINGS_FALLBACK } from '@/lib/leave/workSettings';
import { replacementCanAnswer, requesterMustChooseReplacement } from '@/lib/leave/replacementSignoff';
import {
  ReplacementDeclinedNotice,
  ReplacementRequestCard,
} from '../request/_components/ReplacementSignoff';

export async function ReplacementSignoffCard({ locale }: { locale: string }) {
  const { timeOff } = await getApprovalCapabilities();
  const [t, cover, mine, settings] = await Promise.all([
    getTranslations('replacement'),
    getMyReplacementRequests(),
    // FR-76: no requests of their own without time off.
    timeOff ? getMyLeaveRequests() : Promise.resolve(null),
    getWorkSettings(),
  ]);
  const toSign = (cover.ok ? cover.requests : []).filter((r) =>
    replacementCanAnswer({ status: r.status, signoffStatus: r.signoff_status })
  );
  const declined = (mine?.ok ? mine.requests : []).filter((r) =>
    requesterMustChooseReplacement({ status: r.status, signoffStatus: r.replacement_signoff_status })
  );
  if (toSign.length === 0 && declined.length === 0) return null;
  const hoursPerDay = (settings.ok ? settings.settings : WORK_SETTINGS_FALLBACK).hoursPerDay;

  return (
    <div className="mb-5 space-y-3" data-testid="home-replacement">
      {toSign.length > 0 && (
        <Card className="border-primary/30 bg-primary/5" data-testid="home-replacement-sign">
          <CardHeader>
            <CardTitle className="text-primary">{t('toSignTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {toSign.map((req) => (
              <ReplacementRequestCard key={req.request_id} req={req} locale={locale} hoursPerDay={hoursPerDay} />
            ))}
          </CardContent>
        </Card>
      )}
      {declined.map((req) => (
        <ReplacementDeclinedNotice
          key={req.id}
          req={req}
          summary={
            req.start_date === req.end_date
              ? formatCalendarDate(req.start_date, locale)
              : `${formatCalendarDate(req.start_date, locale)} — ${formatCalendarDate(req.end_date, locale)}`
          }
        />
      ))}
    </div>
  );
}
