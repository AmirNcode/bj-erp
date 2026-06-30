'use client';

import { useState, useTransition } from 'react';
import { useRouter, usePathname } from '@/i18n/navigation';
import { updateMyPrefs, signOut } from '@/lib/actions/profile';
import { Button } from '@/components/ui/button';
import { nativeSelectClass } from '@/lib/native-select';

type Labels = {
  calendar: string;
  language: string;
  jalali: string;
  gregorian: string;
  langFa: string;
  langEn: string;
  logout: string;
  saved: string;
  errorLabel: string;
};

type Props = {
  current: { calendarPref: string; languagePref: string };
  locale: string;
  labels: Labels;
};

export function SettingsForm({ current, locale, labels }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [calendar, setCalendar] = useState(current.calendarPref);
  const [language, setLanguage] = useState(current.languagePref);
  const [msg, setMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const onCalendar = (val: string) => {
    setCalendar(val);
    setMsg('');
    startTransition(async () => {
      const res = await updateMyPrefs({ calendarPref: val as 'jalali' | 'gregorian' });
      setMsg(res.ok ? labels.saved : res.error);
    });
  };

  const onLanguage = (val: string) => {
    setLanguage(val);
    startTransition(async () => {
      await updateMyPrefs({ languagePref: val as 'fa' | 'en' });
      // Switch the locale for the current page (next-intl handles the prefix).
      router.replace(pathname, { locale: val });
    });
  };

  return (
    <div className="space-y-5">
      {msg && (
        <p role="status" className="rounded-lg bg-success-foreground border border-success/20 px-4 py-2 text-sm text-success">
          {msg}
        </p>
      )}

      <div>
        <label htmlFor="settings-calendar" className="block text-sm font-medium mb-1">
          {labels.calendar}
        </label>
        <select
          id="settings-calendar"
          data-testid="settings-calendar"
          value={calendar}
          onChange={(e) => onCalendar(e.target.value)}
          disabled={isPending}
          className={nativeSelectClass}
        >
          <option value="jalali">{labels.jalali}</option>
          <option value="gregorian">{labels.gregorian}</option>
        </select>
      </div>

      <div>
        <label htmlFor="settings-language" className="block text-sm font-medium mb-1">
          {labels.language}
        </label>
        <select
          id="settings-language"
          data-testid="settings-language"
          value={language}
          onChange={(e) => onLanguage(e.target.value)}
          disabled={isPending}
          className={nativeSelectClass}
        >
          <option value="fa">{labels.langFa}</option>
          <option value="en">{labels.langEn}</option>
        </select>
      </div>

      <Button
        type="button"
        variant="outline"
        data-testid="settings-logout"
        onClick={() => startTransition(async () => { await signOut(locale); })}
        disabled={isPending}
        className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        {labels.logout}
      </Button>
    </div>
  );
}
