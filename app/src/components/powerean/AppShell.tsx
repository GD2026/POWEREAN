import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useEanList } from "@/lib/client/list-context";

import { ChecklistIcon, ScanIcon } from "./icons";

export function AppMark() {
  return (
    <svg className="pe-mark" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <g fill="var(--accent-ink)">
        <rect x="14" y="16" width="4" height="32" rx="1" />
        <rect x="21" y="16" width="2" height="32" rx="1" />
        <rect x="26" y="16" width="5" height="32" rx="1" />
        <rect x="34" y="16" width="2" height="32" rx="1" />
        <rect x="39" y="16" width="3" height="32" rx="1" />
        <rect x="45" y="16" width="5" height="32" rx="1" />
      </g>
    </svg>
  );
}

interface AppShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function AppShell({ title, subtitle, actions, children }: AppShellProps) {
  const { list } = useEanList();
  const remaining = list?.items.filter((i) => !i.done).length ?? 0;

  return (
    <div className="pe-shell">
      <header className="pe-top">
        <AppMark />
        <div style={{ minWidth: 0 }}>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="pe-top-actions">{actions}</div>}
      </header>
      <main className="pe-main">{children}</main>
      <nav className="pe-tabbar" aria-label="Hovedmeny">
        <Link to="/" className="pe-tab" activeOptions={{ exact: true }}>
          <ScanIcon aria-hidden />
          Skann
        </Link>
        <Link to="/liste" className="pe-tab">
          <ChecklistIcon aria-hidden />
          EAN-liste
          {remaining > 0 && (
            <span className="pe-badge" aria-label={`${remaining} gjenstår`}>
              {remaining > 999 ? "999+" : remaining}
            </span>
          )}
        </Link>
      </nav>
    </div>
  );
}
