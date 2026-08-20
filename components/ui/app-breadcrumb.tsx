import Link from "next/link";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export function AppBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length < 2) {
    return null;
  }

  return (
    <nav aria-label="Trilha" className="updv-breadcrumb">
      {items.map((item, index) => {
        const ultimo = index === items.length - 1;

        return (
          <span key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {index > 0 && (
              <span className="text-zinc-300" aria-hidden>
                ›
              </span>
            )}
            {ultimo || !item.href ? (
              <span className="truncate text-zinc-700">{item.label}</span>
            ) : (
              <Link href={item.href} className="truncate hover:text-zinc-950">
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
