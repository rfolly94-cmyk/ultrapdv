import type { ReactNode } from "react";

import {
  AppBreadcrumb,
  type BreadcrumbItem,
} from "@/components/ui/app-breadcrumb";

export function PageHeader({
  title,
  count,
  actions,
  description,
  breadcrumb,
}: {
  title: string;
  count?: number | string;
  actions?: ReactNode;
  description?: string;
  breadcrumb?: BreadcrumbItem[];
}) {
  const trilha = breadcrumb && breadcrumb.length >= 2;
  const compacto = !description && !trilha;

  return (
    <header className="shrink-0 border-b border-zinc-200 bg-white">
      {trilha ? <AppBreadcrumb items={breadcrumb} /> : null}
      <div
        className={[
          "flex justify-between gap-3 px-4",
          compacto ? "h-12 items-center" : "items-start py-2.5",
        ].join(" ")}
      >
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold tracking-tight text-zinc-950">
            {title}
            {count !== undefined && (
              <span className="ml-1.5 font-medium text-zinc-400">({count})</span>
            )}
          </h1>
          {description ? <p className="updv-page-desc">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
