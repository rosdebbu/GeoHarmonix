export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading workbench"
      className="bg-canvas flex h-dvh w-full flex-col overflow-hidden"
    >
      <header className="border-line bg-surface flex h-14 w-full animate-pulse items-center justify-between border-b px-4">
        <div className="bg-line-strong h-6 w-32 rounded-md" />
        <div className="flex gap-2">
          <div className="bg-line h-7 w-20 rounded-md" />
          <div className="bg-line h-7 w-16 rounded-md" />
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-3 p-3 overflow-hidden animate-pulse">
        <div className="bg-panel border-line h-9 w-full rounded-md border" />
        <div className="bg-panel border-line flex-1 w-full rounded-lg border min-h-[35rem]" />
        <div className="bg-panel border-line h-20 w-full rounded-lg border" />
      </main>
    </div>
  );
}
