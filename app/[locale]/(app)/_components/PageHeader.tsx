export function PageHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      {action}
    </div>
  );
}
