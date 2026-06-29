type EmptyStateProps = {
  message: string;
};

export function EmptyState({ message }: EmptyStateProps) {
  return (
    <p className="py-4 text-center text-sm text-muted-foreground">{message}</p>
  );
}
