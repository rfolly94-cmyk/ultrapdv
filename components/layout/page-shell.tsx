import type { ReactNode } from "react";

import type { BreadcrumbItem } from "@/components/ui/app-breadcrumb";
import { PageHeader } from "@/components/ui/page-header";

export function PageShell({
  tabs,
  title,
  count,
  actions,
  description,
  breadcrumb,
  toolbar,
  children,
}: {
  tabs?: ReactNode;
  title: string;
  count?: number | string;
  actions?: ReactNode;
  description?: string;
  breadcrumb?: BreadcrumbItem[];
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="updv-page">
      <PageHeader
        title={title}
        count={count}
        actions={actions}
        description={description}
        breadcrumb={breadcrumb}
      />
      {tabs}
      {toolbar}
      {children}
    </main>
  );
}
