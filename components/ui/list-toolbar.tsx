import type { ReactNode } from "react";
import { Search } from "lucide-react";

export function ListToolbar({
  searchPlaceholder,
  searchAction,
  searchDefault,
  searchValue,
  onSearchChange,
  filters,
  actions,
  searchExtras,
}: {
  searchPlaceholder: string;
  searchAction?: string;
  searchDefault?: string;
  searchValue?: string;
  onSearchChange?: (valor: string) => void;
  filters?: ReactNode;
  actions?: ReactNode;
  searchExtras?: ReactNode;
}) {
  const campo = (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
      <input
        name={onSearchChange ? undefined : "q"}
        value={onSearchChange ? searchValue : undefined}
        defaultValue={onSearchChange ? undefined : searchDefault}
        onChange={
          onSearchChange
            ? (event) => onSearchChange(event.target.value)
            : undefined
        }
        placeholder={searchPlaceholder}
        className="updv-input updv-input-search w-full"
      />
    </div>
  );

  return (
    <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
      {onSearchChange ? (
        campo
      ) : (
        <form action={searchAction} method="get" className="min-w-0 flex-1">
          {searchExtras}
          {campo}
        </form>
      )}
      {filters}
      {actions}
    </div>
  );
}
