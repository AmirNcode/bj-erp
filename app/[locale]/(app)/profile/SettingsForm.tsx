'use client';

import { useState, useTransition } from 'react';
import { useRouter, usePathname } from '@/i18n/navigation';
import { updateMyPrefs, signOut } from '@/lib/actions/profile';
import { Button } from '@/components/ui/button';

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

const SELECT_CLASS =
  'w-full border border-input rounded-md bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 h-9';

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
        <p role="status" className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
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
          className={SELECT_CLASS}
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
          className={SELECT_CLASS}
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
        className="w-full border-red-300 text-red-700 hover:bg-red-50 hover:text-red-700"
      >
        {labels.logout}
      </Button>
    </div>
  );
}
