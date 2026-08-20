export default function RelatoriosLoading() {
  return (
    <div className="space-y-4 px-4 py-6">
      <div className="h-8 w-40 animate-pulse rounded bg-zinc-200" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-zinc-100" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-zinc-100" />
    </div>
  );
}
