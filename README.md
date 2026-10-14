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

## Publisere på Render (én gang, ca. 2 minutter)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/GD2026/POWEREAN)

1. Trykk knappen over og logg inn på Render med GitHub-kontoen din (gratis, ingen kort).
2. Trykk **Deploy Blueprint**. Render bygger appen og gir den adressen
   **https://powerean.onrender.com** (eller lignende).
3. Del adressen med kollegaene. Ingen innlogging, ingen konto – den bare virker.

Etterpå oppdateres appen automatisk hver gang koden på `master` endres.

Gratisplanen hos Render sovner etter 15 minutter uten trafikk. En GitHub-jobb
(`.github/workflows/keep-alive.yml`) holder den våken i åpningstiden (man–lør). Hvis Render ga
tjenesten en annen adresse enn `powerean.onrender.com`, legg den inn som repository-variabelen
`APP_URL` (GitHub → Settings → Secrets and variables → Actions → Variables).

## Bruk på iPhone

1. Åpne adressen i Safari.
2. Trykk Del-knappen → **Legg til på Hjem-skjerm**. Appen får eget ikon og åpnes i fullskjerm.
3. Trykk **Start skanning** og tillat kamera. Appen piper når koden er lest.

Tips:
- Listene lagres **på telefonen** – hver kollega har sine egne, og de virker uten nett.
- **Del listen som lenke** (menyen øverst til høyre på EAN-listen): send lenken til PC-en ved
  kassa eller til en kollega. Lenken inneholder selve listen, så den åpnes uten innlogging.
- **Lim inn EAN**: lim inn mange koder på en gang (én per linje, eller med komma/mellomrom).
- Skru opp lysstyrken og hold håndskanneren 10–20 cm fra skjermen. Laserskannere (1D-laser)
  kan ikke lese skjermer; bildeskannere (2D imager) kan.

## Om lagertall

power.no publiserer **ikke eksakt antall per butikk i Norge** (funksjonen
`storeExactStockCountEnabled` er avslått). Appen viser derfor Mariero-status
(«På lager i butikk», «Kan bestilles til butikk», …) og om varen står utstilt, i tillegg til
eksakte tall for nettlager og summen for alle butikker. Hvis POWER slår på eksakte butikktall,
vises de automatisk.

## Teknisk

- React 19 + TanStack Start (SSR) i én liten Node-server (`app/server/node-server.mjs`),
  pakket i `Dockerfile` og beskrevet for Render i `render.yaml`. Ingen database.
- `app/src/lib/power.server.ts` – proxy mot power.no (fast vertsnavn, kun siffer-EAN, timeout,
  skjemavalidering). Mariero = butikk-ID 1690, postnr. 4017.
- `app/src/lib/api/powerean.functions.ts` – eneste server-endepunkt: produktoppslag med
  zod-validering, 60 s cache og 60 oppslag/min per klient.
- `app/src/lib/client/list-store.ts` – listene (localStorage) og delelenker. Lenken legger listen
  i URL-fragmentet (`#del=…`, komprimert), som aldri sendes til serveren.
- `app/src/lib/client/scanner-engine.ts` – innebygd `BarcodeDetector`, ellers ZXing-WASM
  (selvhostet `.wasm`). Krever to like avlesninger før en kode godtas.
- Sikkerhet: streng CSP (`connect-src 'self'`, bilder kun fra POWERs CDN),
  `Permissions-Policy: camera=(self)`, HSTS, `noindex`.

```bash
cd app
bun install
bun run test        # enhetstester
bun run typecheck
bunx vite build && node server/node-server.mjs   # http://localhost:3000
```

Eller med Docker: `docker build -t powerean . && docker run -p 10000:10000 powerean`.

Design-spesifikasjon: [`docs/superpowers/specs/2026-10-13-powerean-design.md`](docs/superpowers/specs/2026-10-13-powerean-design.md).
