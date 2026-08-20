"use client";

import type { ReactNode } from "react";

import {
  ActionMenu,
  type ActionMenuItem,
} from "@/components/ui/action-menu";

export function RowActions({
  editHref,
  editLabel = "Editar - F2",
  onEdit,
  items = [],
  extra,
}: {
  editHref?: string;
  editLabel?: string;
  onEdit?: () => void;
  items?: ActionMenuItem[];
  extra?: ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-1.5"
      onClick={(event) => event.stopPropagation()}
    >
      <ActionMenu items={items} />
      {extra}
      {editHref ? (
        <a href={editHref} className="updv-btn-row">
          {editLabel}
        </a>
      ) : onEdit ? (
        <button type="button" onClick={onEdit} className="updv-btn-row">
          {editLabel}
        </button>
      ) : null}
    </div>
  );
}
