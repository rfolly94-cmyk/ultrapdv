"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type ModuleTab = {
  label: string;
  href: string;
  exact?: boolean;
};

function caminho(href: string) {
  const indice = href.indexOf("?");
  return indice === -1 ? href : href.slice(0, indice);
}

function pontuarTab(pathname: string, tab: ModuleTab) {
  const href = caminho(tab.href);

  if (pathname === href) {
    return href.length + 10000;
  }

  if (tab.exact) {
    return 0;
  }

  if (pathname.startsWith(`${href}/`)) {
    return href.length;
  }

  return 0;
}

export function ModuleTabs({
  tabs,
  ariaLabel = "Seções",
}: {
  tabs: ModuleTab[];
  ariaLabel?: string;
}) {
  const pathname = usePathname();
  const melhor = Math.max(0, ...tabs.map((tab) => pontuarTab(pathname, tab)));

  return (
    <nav
      aria-label={ariaLabel}
      className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto px-[var(--page-pad)]"
    >
      {tabs.map((tab) => {
        const pontos = pontuarTab(pathname, tab);
        const ativa = pontos > 0 && pontos === melhor;

        return (
          <Link
            key={caminho(tab.href)}
            href={tab.href}
            className={[
              "relative shrink-0 px-2.5 py-1.5 text-[13px] font-medium",
              ativa ? "text-[var(--primary)]" : "text-zinc-500 hover:text-zinc-800",
            ].join(" ")}
          >
            {tab.label}
            {ativa && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[var(--primary)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
