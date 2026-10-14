import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/powerean/AppShell";
import { Barcode } from "@/components/powerean/Barcode";
import { FocusMode } from "@/components/powerean/FocusMode";
import {
  AddIcon,
  CheckIcon,
  ChecklistIcon,
  CopyIcon,
  DeleteIcon,
  DoneAllIcon,
  FullscreenIcon,
  InventoryIcon,
  ShareIcon,
} from "@/components/powerean/icons";
import { Sheet } from "@/components/powerean/Sheet";
import { formatPrice } from "@/lib/client/format";
import { useEanList } from "@/lib/client/list-context";
import { parseEanList } from "@/lib/ean";

export const Route = createFileRoute("/liste")({
  head: () => ({ meta: [{ title: "EAN-liste · EAN-skanner" }] }),
  component: ListPage,
});

type Filter = "todo" | "done" | "all";

async function copyText(text: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.error("Fikk ikke kopiert. Prøv igjen.");
  }
}

function ListPage() {
  const ctx = useEanList();
  const { list, listId, isLoading, knownLists, importShared } = ctx;
  const [filter, setFilter] = useState<Filter>("todo");
  const [focus, setFocus] = useState(false);
  const [sheet, setSheet] = useState<"paste" | "menu" | "switch" | null>(null);
  const [pasteText, setPasteText] = useState("");

  // A share link (…/liste#del=<payload>) carries the list itself in the URL
  // fragment, which never reaches the server. Import it, then tidy the URL.
  useEffect(() => {
    if (isLoading) return;
    const match = /^#del=([A-Za-z0-9_-]+)$/.exec(window.location.hash);
    if (!match) return;
    window.history.replaceState(null, "", window.location.pathname);
    void importShared(match[1]).then((count) => {
      if (count == null) toast.error("Lenken er ugyldig eller ødelagt");
      else toast.success(`Åpnet delt liste med ${count} EAN`);
    });
  }, [isLoading, importShared]);

  const items = useMemo(() => list?.items ?? [], [list]);
  const doneCount = items.filter((i) => i.done).length;
  const todoCount = items.length - doneCount;
  const visible = useMemo(
    () => items.filter((i) => (filter === "all" ? true : filter === "done" ? i.done : !i.done)),
    [items, filter],
  );
  const parsed = useMemo(() => parseEanList(pasteText), [pasteText]);

  const share = async () => {
    const shareUrl = await ctx.shareLink();
    if (!shareUrl) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: list?.name ?? "EAN-liste", url: shareUrl });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyText(shareUrl, "Lenken er kopiert – åpne den på PC-en eller send den til en kollega");
  };

  const rename = () => {
    const name = window.prompt("Navn på listen", list?.name ?? "")?.trim();
    if (name) ctx.rename(name.slice(0, 60));
  };

  const addPasted = () => {
    if (parsed.eans.length === 0) return;
    ctx.add(parsed.eans.map((ean) => ({ ean })));
    toast.success(`${parsed.eans.length} EAN lagt til`);
    setPasteText("");
    setSheet(null);
  };

  const confirmThen = (message: string, action: () => void) => {
    if (window.confirm(message)) action();
    setSheet(null);
  };

  return (
    <AppShell
      title="EAN-liste"
      subtitle={
        list ? `${todoCount} gjenstår · ${doneCount} ferdige` : "Skann varer for å fylle listen"
      }
      actions={
        <button
          type="button"
          className="pe-icon-btn"
          aria-label="Flere valg"
          onClick={() => setSheet("menu")}
        >
          <ChecklistIcon />
        </button>
      }
    >
      <section className="pe-card pe-list-head">
        <button
          type="button"
          className="pe-list-name"
          onClick={rename}
          disabled={!list}
          title="Gi listen nytt navn"
        >
          {list?.name ?? (isLoading ? "Laster…" : "Ingen liste ennå")}
        </button>
        <div className="pe-progress" aria-hidden>
          <i style={{ width: items.length ? `${(doneCount / items.length) * 100}%` : "0%" }} />
        </div>
        <button
          type="button"
          className="pe-btn pe-btn--primary pe-btn--big"
          onClick={() => setFocus(true)}
          disabled={todoCount === 0}
        >
          <FullscreenIcon aria-hidden />
          Skannemodus – én og én
        </button>
        <div className="pe-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" className="pe-btn" onClick={() => setSheet("paste")}>
            <AddIcon aria-hidden />
            Lim inn EAN
          </button>
          <button
            type="button"
            className="pe-btn"
            disabled={todoCount === 0}
            onClick={() =>
              void copyText(
                items
                  .filter((i) => !i.done)
                  .map((i) => i.ean)
                  .join("\n"),
                `${todoCount} EAN kopiert`,
              )
            }
          >
            <CopyIcon aria-hidden />
            Kopier EAN
          </button>
        </div>
        <div className="pe-seg" role="group" aria-label="Vis">
          {(
            [
              ["todo", `Gjenstår (${todoCount})`],
              ["done", `Ferdige (${doneCount})`],
              ["all", `Alle (${items.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {visible.length === 0 ? (
        <section className="pe-card pe-empty">
          {filter === "todo" && items.length > 0 ? (
            <DoneAllIcon aria-hidden />
          ) : (
            <InventoryIcon aria-hidden />
          )}
          <h2>
            {filter === "todo" && items.length > 0
              ? "Alt er lagt inn"
              : filter === "done"
                ? "Ingen ferdige ennå"
                : "Listen er tom"}
          </h2>
          <p>
            {filter === "todo" && items.length > 0
              ? "Alle EAN i listen er markert som ferdige."
              : "Skann varer på Skann-fanen, eller lim inn mange EAN på en gang. Hver EAN vises som en strekkode du kan skanne inn i systemet."}
          </p>
        </section>
      ) : (
        <ol className="pe-items" aria-label="EAN-er">
          {visible.map((item) => (
            <li key={item.id} className="pe-card pe-item" data-done={item.done}>
              <div className="pe-item-head">
                <span className="pe-item-index">{items.indexOf(item) + 1}</span>
                {item.thumbUrl ? (
                  <img
                    className="pe-thumb"
                    src={item.thumbUrl}
                    alt=""
                    width={44}
                    height={44}
                    loading="lazy"
                  />
                ) : null}
                <div className="pe-item-title">
                  <b>{item.title ?? "Ukjent produkt"}</b>
                  {item.price != null && (
                    <span className="pe-small pe-muted">{formatPrice(item.price)}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="pe-icon-btn pe-check"
                  aria-pressed={item.done}
                  aria-label={item.done ? "Marker som ikke ferdig" : "Marker som ferdig"}
                  onClick={() => ctx.setDone(item.id, !item.done)}
                >
                  <CheckIcon />
                </button>
                <button
                  type="button"
                  className="pe-icon-btn pe-btn--danger"
                  aria-label={`Fjern ${item.ean}`}
                  onClick={() => ctx.remove(item.id)}
                >
                  <DeleteIcon />
                </button>
              </div>
              <Barcode value={item.ean} />
            </li>
          ))}
        </ol>
      )}

      {focus && list && (
        <FocusMode
          items={list.items}
          onDone={(id) => ctx.setDone(id, true)}
          onClose={() => setFocus(false)}
        />
      )}

      {sheet === "paste" && (
        <Sheet title="Lim inn EAN" onClose={() => setSheet(null)}>
          <p className="pe-small pe-muted" style={{ margin: 0 }}>
            Én EAN per linje, eller skilt med komma/mellomrom. Duplikater hoppes over.
          </p>
          <textarea
            className="pe-input pe-input--mono"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"7041234567890\n5901234123457"}
            inputMode="numeric"
            autoFocus
            maxLength={20000}
          />
          <p className="pe-small" style={{ margin: 0 }}>
            {parsed.eans.length} gyldige
            {parsed.rejected.length > 0 && (
              <span style={{ color: "var(--bad)" }}>
                {" "}
                · {parsed.rejected.length} ugyldige hoppes over
              </span>
            )}
          </p>
          <button
            type="button"
            className="pe-btn pe-btn--primary pe-btn--big"
            disabled={parsed.eans.length === 0}
            onClick={addPasted}
          >
            Legg til {parsed.eans.length || ""} EAN
          </button>
        </Sheet>
      )}

      {sheet === "menu" && (
        <Sheet title="Liste" onClose={() => setSheet(null)}>
          <div className="pe-menu">
            <button
              type="button"
              className="pe-btn"
              disabled={!listId}
              onClick={() => void share().then(() => setSheet(null))}
            >
              <ShareIcon aria-hidden /> Del listen som lenke (PC eller kollega)
            </button>
            <button
              type="button"
              className="pe-btn"
              disabled={items.length === 0}
              onClick={() =>
                void copyText(
                  items.map((i) => i.ean).join("\n"),
                  `${items.length} EAN kopiert`,
                ).then(() => setSheet(null))
              }
            >
              <CopyIcon aria-hidden /> Kopier alle EAN (også ferdige)
            </button>
            <button
              type="button"
              className="pe-btn"
              disabled={todoCount === 0}
              onClick={() => {
                ctx.setAllDone(true);
                setSheet(null);
              }}
            >
              <DoneAllIcon aria-hidden /> Marker alle som ferdige
            </button>
            <button
              type="button"
              className="pe-btn"
              disabled={doneCount === 0}
              onClick={() => {
                ctx.setAllDone(false);
                setSheet(null);
              }}
            >
              <CheckIcon aria-hidden /> Marker alle som ikke ferdige
            </button>
            <button
              type="button"
              className="pe-btn"
              disabled={doneCount === 0}
              onClick={() =>
                confirmThen(`Fjerne ${doneCount} ferdige EAN fra listen?`, () => ctx.clear(true))
              }
            >
              <DeleteIcon aria-hidden /> Fjern ferdige
            </button>
            <button
              type="button"
              className="pe-btn pe-btn--danger"
              disabled={items.length === 0}
              onClick={() =>
                confirmThen("Tømme hele listen? Dette kan ikke angres.", () => ctx.clear(false))
              }
            >
              <DeleteIcon aria-hidden /> Tøm hele listen
            </button>
            <button
              type="button"
              className="pe-btn"
              onClick={() => {
                ctx.startNewList();
                toast.success("Ny tom liste");
                setSheet(null);
              }}
            >
              <AddIcon aria-hidden /> Ny tom liste
            </button>
            {knownLists.filter((l) => l.id !== listId).length > 0 && (
              <button type="button" className="pe-btn" onClick={() => setSheet("switch")}>
                <ChecklistIcon aria-hidden /> Bytt til en tidligere liste
              </button>
            )}
          </div>
        </Sheet>
      )}

      {sheet === "switch" && (
        <Sheet title="Tidligere lister" onClose={() => setSheet(null)}>
          <div className="pe-menu">
            {knownLists
              .filter((l) => l.id !== listId)
              .map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className="pe-btn"
                  onClick={() => {
                    ctx.switchTo(l.id);
                    setSheet(null);
                  }}
                >
                  {l.name} · {l.count} EAN
                </button>
              ))}
          </div>
        </Sheet>
      )}
    </AppShell>
  );
}
