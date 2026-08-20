import type { ReactNode } from "react";

import { FiscalConfigChrome } from "@/components/fiscal/fiscal-config-chrome";

export default function FiscalConfigLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="updv-page">
      <FiscalConfigChrome />
      {children}
    </div>
  );
}
