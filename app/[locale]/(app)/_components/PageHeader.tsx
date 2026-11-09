import { cn } from '@/lib/utils';

/**
 * `section`: the title repeats the section name the phone's top bar already
 * shows (MobileTopBar), so on phones it is kept for screen readers only.
 */
export function PageHeader({
  title,
  action,
  section,
}: {
  title: string;
  action?: React.ReactNode;
  section?: boolean;
}) {
  return (
    <div
      className={cn(
        'mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between',
        section && !action && 'max-md:mb-0'
      )}
    >
      <h1 className={cn('text-xl font-bold tracking-tight', section && 'max-md:sr-only')}>{title}</h1>
      {action}
    </div>
  );
}
