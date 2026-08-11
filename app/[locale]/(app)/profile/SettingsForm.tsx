'use client';

import { useState, useTransition } from 'react';
import { useRouter, usePathname } from '@/i18n/navigation';
import { updateMyPrefs } from '@/lib/actions/profile';
import { nativeSelectClass } from '@/lib/native-select';

type Labels = {
  language: string;
  langFa: string;
  langEn: string;
};

type Props = {
  current: { languagePref: string };
  labels: Labels;
};

export function SettingsForm({ current, labels }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [language, setLanguage] = useState(current.languagePref);
  const [isPending, startTransition] = useTransition();

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
    </div>
  );
}
