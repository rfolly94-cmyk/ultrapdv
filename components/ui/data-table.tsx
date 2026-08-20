import type { ReactNode } from "react";

export function DataTable({
  children,
  minWidth = 900,
}: {
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="updv-table-shell">
      <div className="updv-table-scroll">
        <table className="updv-table" style={{ minWidth }}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function DataTableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="updv-table-empty">
        {children}
      </td>
    </tr>
  );
}
