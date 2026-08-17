'use client';

/**
 * Mobile request-type picker. Four tabs do not fit across a phone without
 * horizontal scrolling, so below `sm` the strip is replaced by this native
 * <select> — it opens the OS picker, which reads better on a phone than any
 * custom menu, and Playwright's selectOption works on it.
 *
 * Each request type is its own route, so choosing an option navigates.
 */

import { useTransition } from 'react';
import { useRouter } from '@/i18n/navigation';
import { nativeSelectClass } from '@/lib/native-select';

type Props = {
  label: string;
  /** The active route — also the <select> value, since options are keyed by href. */
  value: string;
  options: { value: string; label: string }[];
};

export function RequestTypeSelect({ label, value, options }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="space-y-1.5">
      <label htmlFor="request-type" className="block text-sm leading-none font-medium">
        {label}
      </label>
      <select
        id="request-type"
        value={value}
        disabled={isPending}
        onChange={(event) => {
          const href = event.target.value;
          startTransition(() => router.push(href));
        }}
        className={nativeSelectClass}
        data-testid="request-type-select"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
