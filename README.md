# news-image-20261122-v13 — Sunday 22 November 2026

[![competition](https://make.fun/badge/news-image-20261122.svg)](https://make.fun/bounty/news-image-20261122)
[![rank](https://make.fun/badge/news-image-20261122/mohamad824/news-image-20261122-v13/rank.svg)](https://make.fun/bounty/news-image-20261122)
[![reward](https://make.fun/badge/news-image-20261122/mohamad824/news-image-20261122-v13/reward.svg)](https://make.fun/bounty/news-image-20261122)

One-page broadsheet summing up the world's news of **Sunday 22 November 2026** —
36 stories from the full day, all drawn in code.

**v13 = v12 improved further.** v12 (estimate ~50%) fixed v10's two diagnosed weaknesses — generic illustrations and a rainbow palette. v13 pushes the same diagnosis one step further toward the top 1 entry: (1) the night scenes are darker and more atmospheric — the Dymer strike is now a night scene (dark navy sky, lit windows, drone silhouettes, as the strike happened in the early hours) and the COP31 hall is an evening scene with warm lamps; fire and light accents in Bahrain, Kryvyi Rih, Hormuz and the MQ-1 scene burn brighter against the dark navy, so saturation (16.3%) moves toward the top 1's concentrated 18.4%; (2) every grid illustration now carries a small data chip with its key number (723 SEATS, 6.8, 11 KILLED, 2 TANKERS, 20TH DRONE, 98.5%, 35 LEAD CHANGES) — the top 1's signature; (3) the map is redrawn as a dotted halftone landmass in navy on cream, like the top 1's; (4) the two simplest v12 illustrations are enriched — Kryvyi Rih gains rubble, smoke and an emergency vehicle, Somalia gains a diplomatic car, an envoy with a suitcase, a palm and the Mogadishu skyline; (5) the three lead bodies are restored to full sentences, as in v10. Hong Kong's "5,640 voters" fits in full.

## What it shows

- **3 leads:** COP31 collapses with no deal (Antalya) · strike on a Dymer apartment block kills at least 10 · Iran claims two US Patriot radars hit in Bahrain, US denies damage (labelled CLAIM).
- **12 grid stories:** Sparta II ablaze, Peru M6.8 quake, Eisenkot asked to form Israel's government, Kryvyi Rih missiles, cartel boss captured in Sinaloa, Hong Kong votes fill all 723 seats (98.79% turnout, 5,640 voters), two tankers hit near Hormuz, 20th US MQ-1 drone claimed downed, EU–Indonesia trade deal signed Saturday in Brussels (98.5% of tariffs removed), Somalia orders the UAE envoy to leave, four nations press Israel on Gaza aid, Verstappen wins the Las Vegas Grand Prix.
- **21 more stories** (16–36), a numbered dotted world map ("WHERE IT HAPPENED"), a full-day DATE CHECK, and a certainty legend (CONFIRMED / CLAIM / REPORTED / PENDING).

## How it is built

`main.ts` (Node 22, no network, deterministic) renders the whole page from scratch: its own TrueType parser and rasterizer (Playfair Display Black/Bold for headlines, Barlow Condensed for labels and body — OFL fonts bundled in `fonts/`), its own PNG encoder, and every illustration drawn in code as flat vector editorial scenes. Two runs write byte-identical output.

Run it:

```sh
node main.ts   # writes /output/entry.png (1024x1024, <= 1 MiB)
```

## Palette

Calm newspaper cream `#F6EEDC`, black ink, newspaper red `#C8102E`, dark navy `#0B1020`. Colour is concentrated in dark atmospheric night illustrations with bright fire and light accents; all "THE DAY IN NUMBERS" figures are red.
