/**
 * Profile › Profile tab (FR-23, FR-96): name and code, photo (FR-82), the SMS
 * mobile everyone sets themselves, and the saved signature (FR-52).
 * Desktop: two columns; phones: one, in that order.
 */

export const dynamic = 'force-dynamic';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCachedUser, getCachedProfile } from '@/lib/auth/context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SavedSignatureCard } from './SavedSignatureCard';
import { getMySavedSignature } from '@/lib/actions/signature';
import { getPhotoInfo } from '@/lib/actions/photo';
import { ProfilePhotoCard } from '@/components/profile-photo/ProfilePhotoCard';
import { SmsMobileCard } from '@/components/profile/SmsMobileCard';
import { createClient } from '@/lib/supabase/server';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ProfilePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCachedUser();
  if (!user) return null;

  const supabase = await createClient();
  const [t, tSig, tMobile, profile, savedRes, photoRes, { data: personalInfo }] = await Promise.all([
    getTranslations('profile'),
    getTranslations('profile.signature'),
    getTranslations('profile.mobile'),
    getCachedProfile(user.id),
    getMySavedSignature(),
    getPhotoInfo(user.id),
    supabase.from('employee_personal_info').select('mobile').eq('employee_id', user.id).maybeSingle(),
  ]);

  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-2 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('name')}</span>
              <span className="font-medium">{profile?.full_name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('code')}</span>
              <span className="font-mono">{profile?.employee_code ?? '—'}</span>
            </div>
          </CardContent>
        </Card>

        {/* FR-82: the only place people change their own photo (HR uses Edit employee). */}
        <Card>
          <CardContent className="pt-2">
            <ProfilePhotoCard
              employeeId={user.id}
              name={profile?.full_name ?? ''}
              initial={photoRes.ok ? photoRes.photo : null}
              mode="self"
            />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {/* FR-96: everyone sets the number SMS notifications go to. */}
        <Card data-testid="sms-mobile-card">
          <CardHeader className="border-b pb-4">
            <CardTitle>{tMobile('title')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <SmsMobileCard initial={personalInfo?.mobile ?? null} />
          </CardContent>
        </Card>

        {/* FR-52: saved signature */}
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>{tSig('title')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <SavedSignatureCard initial={savedRes.ok ? savedRes.signature : null} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
