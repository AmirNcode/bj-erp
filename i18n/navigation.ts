import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// Locale-aware navigation APIs (respect localePrefix: 'as-needed'). Used for the
// language switcher; the rest of the app uses manual `/${locale}/…` hrefs.
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
