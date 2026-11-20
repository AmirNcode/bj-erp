'use client';

/**
 * FR-95: a test account (`test-emp`, …) sees every request page but cannot send. The request
 * layout sets the flag; each form adds it to its Submit button's `disabled`. The database
 * refuses the insert anyway (`leave_requests_requester_has_time_off`).
 */

import { createContext, useContext } from 'react';
import { useTranslations } from 'next-intl';

const TestAccountContext = createContext(false);

export function TestAccountProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  const t = useTranslations('request');
  return (
    <TestAccountContext.Provider value={value}>
      {value && (
        <p
          role="note"
          className="mx-auto mt-4 w-full max-w-3xl rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
          data-testid="test-account-notice"
        >
          {t('testAccountNotice')}
        </p>
      )}
      {children}
    </TestAccountContext.Provider>
  );
}

export const useTestAccount = () => useContext(TestAccountContext);
