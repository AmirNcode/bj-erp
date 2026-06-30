export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}
