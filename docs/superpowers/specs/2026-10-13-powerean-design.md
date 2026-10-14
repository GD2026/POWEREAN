# PowerEAN – EAN-skanner for POWER Mariero (design)

Date: 2026-10-13 · Status: approved (the user asked for a fully autonomous build: "i am not gonna do anything", "Dont ask for permission just do it")

## Intent

A store employee at POWER Mariero (Stavanger) needs a phone app that:

1. **Scans** product barcodes (EAN-13 / EAN-8 / UPC) with the phone camera and shows the
   product's **image, price and stock** at POWER Mariero, fetched from power.no.
2. Has an **"EAN-liste"** section where every collected EAN is shown **as a scannable barcode,
   one under another**. The employee can then point the store's handheld scanner at the phone
   screen and enter the codes into POWER's internal system one at a time. Today this is done
   in a manual system that works badly.

Success: scan → product card in about 1 s; a list of 30+ EANs can be fed into the internal
system code by code without retyping; works on iPhone (Safari / home-screen app).

### What the user said vs. what I assumed

| Said | Assumed |
|---|---|
| Scan EAN, get image, stock count and price from POWER Norge Mariero | Data comes from power.no's public web API (the same one the website uses). There is no internal POWER system access. |
| EAN list, codes under each other, scan 1 by 1 | The phone shows real barcodes on a white background that a handheld 2D imager can read off the screen. A focus mode shows one big code at a time with "Neste". |
| iOS | Installable web app (PWA, "Legg til på Hjem-skjerm"), not an App Store app: no Xcode, no developer account, and nothing for the user to do. |
| New git repo | GitHub `GD2026/POWEREAN` holds the source. Hosting is a Higgsfield website (Cloudflare Worker + D1). |

## Data source findings (verified 2026-10-13)

- `GET https://www.power.no/api/v2/productlists?q=<EAN>&size=5` finds a product by EAN
  (12- and 13-digit forms both work). It returns `productId, title, manufacturerName, price,
  previousPrice, previousPriceDisclaimer, productImage{basePath,variants[]}, url,
  stockCount` (online warehouse), `storesStockCount` (sum of all stores) and `webStockText`.
- `GET https://www.power.no/api/v2/products/<id>/stores?postalCode=4017` lists stores near
  Mariero. POWER Mariero is `storeId 1690` (Langflåtveien 21, 4017 Stavanger). Per store:
  `storeAvailability` (enum: 1 NotAvailable, 2 ClickNCollect/in stock, 3 StoreOnly,
  4 StoreDelivery/order to store, 5 CCCWAvailable/order online pick up, 6 display product),
  `storeDisplayStock` (0/1 on display).
- **Exact per-store unit counts are not published for Norway**: the frontend flag
  `storeExactStockCountEnabled` is off and `storeStockCount` is absent. If POWER enables it, the
  app shows the number automatically. Until then the app shows the Mariero status, whether a
  unit is on display, the online-warehouse count and the all-stores count.
- The API sends no CORS headers, so the browser cannot call it directly. A server-side proxy
  is required. Images on `media.power-cdn.net` load directly.

## Architecture

One Cloudflare Worker (TanStack Start, React 19, SSR) on Higgsfield hosting:

- `src/lib/power.server.ts`: the Power client. EAN-validated input, fixed hosts only (no
  SSRF surface), timeouts, response-shape validation, normalisation to a small `ProductInfo`.
- `src/lib/ean.ts`: shared pure helpers: normalise, validate GS1 check digit, choose the
  barcode symbology (EAN13 / EAN8 / UPC / CODE128 fallback).
- Server functions (`createServerFn` + zod):
  - `lookupProduct({ ean })`: cached 60 s in the Workers Cache API, rate-limited per IP (D1).
  - Lists (D1): `createList`, `getList`, `addItems`, `setItemDone`, `deleteItem`,
    `clearDone`, `renameList`. A list is addressed by a random UUID (capability URL), so it
    can be shared between phone and PC by link. Limits: 1000 items/list, 500 per bulk add.
- UI (Norwegian bokmål, mobile-first, safe-area aware, light + dark):
  - **Skann** (`/`): live camera with native `BarcodeDetector`, or the ZXing-WASM ponyfill on
    iOS (WASM self-hosted, no third-party CDN). Requires two identical reads before accepting,
    cooldown for repeats, beep + vibration, torch where supported, manual entry fallback.
    Shows the product card and auto-adds to the active list (toggle).
  - **EAN-liste** (`/liste`): a barcode per row (white quiet zone), done-toggle, delete, paste
    many EANs, copy all as text, share link, "Fjern ferdige", and **Skannemodus**: one huge
    code, "Neste", screen wake-lock.
- Security: strict input validation, CSP (`connect-src 'self'`, images from POWER CDN only),
  `Permissions-Policy: camera=(self)`, no secrets, no PII stored. List IDs are UUIDv4.

## Error handling

Power down or timeout → the card says "Fikk ikke kontakt med power.no" with "Prøv igjen";
the EAN is still added to the list. Unknown EAN → "Fant ikke produktet på power.no", still
listed (the code still has to go into the internal system). Camera denied → explain how to
allow it in iOS Settings and offer manual entry.

## Testing

Vitest unit tests for `ean.ts` (check digits, normalisation, symbology) and for the Power
response normaliser against recorded fixtures. Typecheck plus production build. A live smoke
test of the deployed `/api` paths with a real EAN (AirPods Pro 3, `195950543650`).

## Revision 2026-10-14: hosted on Render, no database

The user asked for colleagues to be able to use the app without Higgsfield
(an unpublished Higgsfield site requires the owner's Higgsfield login), and
suggested Render.

- **Hosting:** one free Render web service built from `Dockerfile`
  (`render.yaml` Blueprint, one-click "Deploy to Render" button). The app runs
  as a small Node server (`app/server/node-server.mjs`) around the TanStack
  Start fetch handler; static files are served with long-lived caching and
  Brotli/gzip.
- **No database:** Render's free plan has no persistent disk and free Postgres
  expires, so lists moved to the device (localStorage, `client/list-store.ts`).
  Each colleague has their own lists, and they work offline. "Del listen som
  lenke" puts the list, deflated and base64url-encoded, in the URL fragment
  (`/liste#del=…`). The fragment never reaches the server, and the receiving
  device validates it before importing.
- **Server:** stateless. It only runs the product lookup, with an in-process
  60 s cache and a 60/min per-client rate limit.
- **Cold starts:** Render's free plan sleeps after 15 idle minutes (~1 min to
  wake). `.github/workflows/keep-alive.yml` pings `/healthz` every 5 minutes
  during store hours. This costs nothing because the repository is public.
