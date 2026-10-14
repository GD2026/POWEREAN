import { createFileRoute, Link } from "@tanstack/react-router";
import type { ComponentType, SVGProps } from "react";

import { AppMark } from "@/components/powerean/AppShell";
import { ChecklistIcon, ChevronIcon, StockCheckIcon, ScanIcon } from "@/components/powerean/icons";
import { useEanList } from "@/lib/client/list-context";

export const Route = createFileRoute("/")({
  component: Home,
});

type Choice = {
  to: "/skann" | "/liste" | "/lager";
  title: string;
  text: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: string;
};

const CHOICES: Choice[] = [
  {
    to: "/skann",
    title: "Skann EAN",
    text: "Strekkode → bilde, pris og lager",
    Icon: ScanIcon,
    tone: "var(--accent)",
  },
  {
    to: "/liste",
    title: "EAN-liste",
    text: "Skann kodene inn i systemet én og én",
    Icon: ChecklistIcon,
    tone: "var(--ok)",
  },
  {
    to: "/lager",
    title: "Lagersjekk",
    text: "Bilde av prislappen → lagerstatus",
    Icon: StockCheckIcon,
    tone: "var(--warn)",
  },
];

function Home() {
  const { list } = useEanList();
  const remaining = list?.items.filter((i) => !i.done).length ?? 0;

  return (
    <div className="pe-home">
      <header className="pe-home-head">
        <AppMark />
        <div>
          <h1>EAN-skanner</h1>
          <p>POWER Mariero</p>
        </div>
      </header>

      <nav className="pe-home-choices" aria-label="Velg verktøy">
        {CHOICES.map(({ to, title, text, Icon, tone }, i) => (
          <Link key={to} to={to} className="pe-card pe-choice">
            <span className="pe-choice-icon" style={{ background: tone }} aria-hidden>
              <Icon />
            </span>
            <span className="pe-choice-text">
              <b>
                <span className="pe-choice-num">{i + 1}.</span> {title}
              </b>
              <span>{text}</span>
            </span>
            {to === "/liste" && remaining > 0 && (
              <span className="pe-badge pe-badge--inline" aria-label={`${remaining} gjenstår`}>
                {remaining}
              </span>
            )}
            <ChevronIcon className="pe-choice-chevron" aria-hidden />
          </Link>
        ))}
      </nav>

      <p className="pe-disclaimer">
        Uoffisielt hjelpeverktøy. Pris og lager hentes fra power.no og kan avvike fra
        butikksystemet.
      </p>
    </div>
  );
}
