// Root layout — next-intl locale layout handles <html> with lang/dir.
// This file is required by Next.js App Router but the actual HTML shell
// lives in app/[locale]/layout.tsx.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
