import JsBarcode from "jsbarcode";
import { useEffect, useRef } from "react";

import { barcodeFormatFor } from "@/lib/ean";

interface BarcodeProps {
  value: string;
  /** "list" for rows in the EAN list, "focus" for the full-screen scan mode. */
  size?: "list" | "focus";
}

const SIZES = {
  list: { width: 2, height: 64, fontSize: 18, margin: 12 },
  focus: { width: 3, height: 140, fontSize: 26, margin: 18 },
} as const;

/**
 * Draws the EAN as a real barcode (black on white, with quiet zones) that a
 * handheld store scanner can read off the screen. Rendered on the client only;
 * the SSR placeholder keeps the layout from jumping.
 */
export function Barcode({ value, size = "list" }: BarcodeProps) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const opts = SIZES[size];
    const draw = (format: string) => {
      let valid = true;
      JsBarcode(svg, value, {
        format,
        width: opts.width,
        height: opts.height,
        margin: opts.margin,
        fontSize: opts.fontSize,
        textMargin: 2,
        font: "ui-monospace, SFMono-Regular, Menlo, monospace",
        background: "#ffffff",
        lineColor: "#000000",
        displayValue: true,
        flat: false,
        valid: (ok) => {
          valid = ok;
        },
      });
      return valid;
    };
    if (!draw(barcodeFormatFor(value))) draw("CODE128");
    // Scale with the container instead of using JsBarcode's fixed pixel size.
    const w = svg.getAttribute("width");
    const h = svg.getAttribute("height");
    if (w && h) {
      svg.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
  }, [value, size]);

  const placeholderHeight = SIZES[size].height + SIZES[size].fontSize + SIZES[size].margin * 2;
  return (
    <div className="pe-barcode">
      <svg
        ref={ref}
        role="img"
        aria-label={`Strekkode ${value}`}
        style={{ minHeight: size === "focus" ? undefined : placeholderHeight / 2 }}
      />
    </div>
  );
}
