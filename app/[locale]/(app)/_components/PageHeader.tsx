import { PageRefreshButton } from './PageRefreshButton';

export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  const initialUpdatedAt = new Date().toISOString();

  return (
    <div className="mb-5 space-y-2">
      <PageRefreshButton initialUpdatedAt={initialUpdatedAt} />
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {action}
      </div>
    </div>
  );
}
