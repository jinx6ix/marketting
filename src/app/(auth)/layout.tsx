export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            Wanderlust Marketing OS
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Travel &amp; tours marketing, publishing and monitoring
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
