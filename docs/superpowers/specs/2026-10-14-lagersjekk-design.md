# Lagersjekk + startside (design)

Date: 2026-10-14 · Status: approved (the user asked for it to be built directly)

## Intent (user's words, translated)

When the app opens there are three choices: 1. Scan EAN, 2. EAN list, 3. Stock info
checker. The checker uses the camera on a price tag ("LG G6 OLED TV", "iPhone 17 Pro Max
512GB (Sort)") and tries to read the article number, the name or anything else that can
be searched on power.no. Display items often cannot be scanned by EAN. The goal is to
check stock quickly in the store.

## Design

- `/` is a start page with three large numbered choices. The scanner moved to `/skann`. The
  tab bar on the tools has three tabs (Skann EAN, EAN-liste, Lagersjekk), and the logo leads
  home.
- `/lager`: a live camera with a price-tag frame and a shutter button, plus "Velg bilde" (photo
  library or native camera) and a text field (iOS Live Text works there too).
- **Text reading (OCR) on the phone:** Tesseract.js 7 with the LSTM engine, the Norwegian
  `best_int` model and self-hosted core, worker and language data (about 6 MB, cached as
  immutable). The frame is cropped, scaled to about 1800 px, converted to grayscale and
  contrast-stretched first. No photo leaves the phone. Tesseract was chosen over a vision
  LLM because it needs no API key and has no running cost.
- **Candidates** (`extractTagCandidates`), in this order: 7-digit POWER article numbers, valid
  EANs, model codes (uppercase letters and digits), then name lines with at least 2 words.
  The best one is searched automatically. The others are shown as chips, one tap each.
- **Search** (`searchPowerProducts`): an article number is fetched exactly via
  `/api/v2/products?ids=`. Otherwise `buildSearchQueries` cleans the text (it splits
  "512GB" into "512 GB", the way power.no writes it, and drops colours, prices and label
  words) and retries with words dropped from the end, because power.no requires every word
  to match. Hits are ranked by word overlap with the tag text, including colour synonyms
  (sort → svart). The top 6 results get Mariero stock in parallel. The result is cached for
  60 s, and a search counts as three lookups for rate limiting.

## Verified

Unit tests for candidates, queries, ranking and search fallbacks. A browser test runs
against the Docker image. A photographed LG tag is read through the camera: the article
number 4279577 is found and the correct TV comes first. An uploaded iPhone tag with no
article number finds "iPhone 17 Pro Max 512 GB".
