/**
 * Profile › Profile tab (FR-23, FR-96): name and code, photo (FR-82), the SMS
 * mobile everyone sets themselves, and the saved signature (FR-52).
 * Desktop: photo + name in one tile, then signature | SMS half-width tiles.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SavedSignatureCard } from './SavedSignatureCard';
import { getMySavedSignature } from '@/lib/actions/signature';
import { getPhotoInfo } from '@/lib/actions/photo';
import { ProfilePhotoCard } from '@/components/profile-photo/ProfilePhotoCard';
import { SmsMobileCard } from '@/components/profile/SmsMobileCard';
import { createClient } from '@/lib/supabase/server';
import { getMyRecentSms } from '@/lib/actions/personal-info';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) return null;

  const supabase = await createClient();
  const [t, tSig, tMobile, profile, savedRes, photoRes, { data: personalInfo }, smsRes] = await Promise.all([
    getTranslations('profile'),
    getTranslations('profile.signature'),
    getTranslations('profile.mobile'),
    getCachedProfile(user.id),
    getMySavedSignature(),
    getPhotoInfo(user.id),
    supabase.from('employee_personal_info').select('mobile').eq('employee_id', user.id).maybeSingle(),
    getMyRecentSms(3),
  ]);

  return (
    <div className="space-y-4">
      {/* Photo (FR-82) and name/code share one tile, each half of it. */}
      <Card>
        <CardContent className="grid gap-4 pt-2 md:grid-cols-2 md:items-center">
          {/* FR-82: the only place people change their own photo (HR uses Edit employee). */}
          <ProfilePhotoCard
            employeeId={user.id}
            name={profile?.full_name ?? ''}
            initial={photoRes.ok ? photoRes.photo : null}
            mode="self"
          />
          <div className="space-y-1 text-sm max-md:order-first max-md:border-b max-md:pb-4 md:border-s md:ps-6">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('name')}</span>
              <span className="font-medium">{profile?.full_name ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('code')}</span>
              <span className="font-mono">{profile?.employee_code ?? '—'}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Half each: signature on the left, SMS on the right in both directions; phones: SMS first. */}
      {/* Equal height; the SMS form sits at the bottom, level with the signature buttons. */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* FR-52: saved signature */}
        <Card className="md:rtl:order-last">
          <CardHeader className="border-b pb-4">
            <CardTitle>{tSig('title')}</CardTitle>
            <CardDescription>{tSig('hint')}</CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <SavedSignatureCard initial={savedRes.ok ? savedRes.signature : null} />
          </CardContent>
        </Card>

        {/* FR-96: everyone sets the number SMS notifications go to. */}
        <Card data-testid="sms-mobile-card" className="max-md:order-first">
          <CardHeader className="border-b pb-4">
            <CardTitle>{tMobile('title')}</CardTitle>
            <CardDescription>{tMobile('hint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col pt-4">
            <SmsMobileCard initial={personalInfo?.mobile ?? null} history={smsRes.ok ? smsRes.rows : []} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
