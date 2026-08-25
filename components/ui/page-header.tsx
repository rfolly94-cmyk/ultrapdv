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

  return (
    <header className="shrink-0">
      {trilha ? <AppBreadcrumb items={breadcrumb} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-3 px-[var(--page-pad)] py-5">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-zinc-950">
            {title}
            {count !== undefined && (
              <span className="ml-1.5 text-[16px] font-medium text-zinc-400">
                ({count})
              </span>
            )}
          </h1>
          {description ? <p className="updv-page-desc">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
