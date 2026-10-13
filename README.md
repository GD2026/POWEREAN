# PowerEAN – EAN-skanner for POWER Mariero

Mobil-app (installerbar nettapp) for butikkgulvet:

- **Skann** – pek kameraet mot en strekkode (EAN-13, EAN-8, UPC). Appen henter **bilde, pris
  (inkl. førpris) og lagerstatus for POWER Mariero** fra power.no, pluss antall på nettlager og
  totalt i alle POWER-butikker.
- **EAN-liste** – alt du skanner havner i en liste der hver EAN vises **som en ekte strekkode,
  under hverandre**. Skann dem inn i butikksystemet med håndskanneren rett fra skjermen.
  **Skannemodus** viser én stor kode om gangen: «Ferdig – neste» markerer den og går videre.
  Skjermen holdes våken.

> Uoffisielt hjelpeverktøy. Data hentes fra power.no sitt offentlige web-API og kan avvike fra
> butikksystemet.

## Bruk på iPhone

1. Åpne **https://powerean.higgsfield.app** i Safari.
2. Trykk Del-knappen → **Legg til på Hjem-skjerm**. Appen får eget ikon og åpnes i fullskjerm.
3. Trykk **Start skanning** og tillat kamera. Appen piper når koden er lest.

Tips:
- **Lim inn EAN**: lim inn mange koder på en gang (én per linje, eller med komma/mellomrom).
- **Del lenke til listen** (menyen øverst til høyre på EAN-listen): åpne samme liste på PC-en ved
  kassa. Listen synkroniseres hvert 15. sekund.
- Uten nett lagres skannede EAN på telefonen og legges inn automatisk når du har dekning igjen.
- Skru opp lysstyrken og hold håndskanneren 10–20 cm fra skjermen. Laserskannere (1D-laser)
  kan ikke lese skjermer; bildeskannere (2D imager) kan.

## Om lagertall

power.no publiserer **ikke eksakt antall per butikk i Norge** (funksjonen
`storeExactStockCountEnabled` er avslått). Appen viser derfor Mariero-status
(«På lager i butikk», «Kan bestilles til butikk», …) og om varen står utstilt, i tillegg til
eksakte tall for nettlager og summen for alle butikker. Hvis POWER slår på eksakte butikktall,
vises de automatisk.

## Teknisk

- React 19 + TanStack Start (SSR) i én Cloudflare Worker, hostet på Higgsfield. Lister i D1.
- `app/src/lib/power.server.ts` – proxy mot power.no (fast vertsnavn, kun siffer-EAN, timeout,
  skjemavalidering). Mariero = butikk-ID 1690, postnr. 4017.
- `app/src/lib/api/powerean.functions.ts` – serverfunksjoner med zod-validering og
  rate limiting (60 oppslag/min per IP, IP lagres kun som hash). Lister adresseres med UUIDv4.
- `app/src/lib/client/scanner-engine.ts` – innebygd `BarcodeDetector`, ellers ZXing-WASM
  (selvhostet `.wasm`, ingen tredjeparts-CDN). Krever to like avlesninger før en kode godtas.
- Sikkerhet: streng CSP (`connect-src 'self'`, bilder kun fra POWERs CDN),
  `Permissions-Policy: camera=(self)`, HSTS, `noindex`.
- Design-spesifikasjon: [`docs/superpowers/specs/2026-10-13-powerean-design.md`](docs/superpowers/specs/2026-10-13-powerean-design.md).

```bash
cd app
bun install
bun run test        # enhetstester (Node 22+)
bun run typecheck
bunx vite build     # bygger Worker + klient til dist/
```

Lokal kjøring med database: `npx wrangler d1 migrations apply DB --local && npx wrangler dev`.
