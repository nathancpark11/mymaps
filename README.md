# My-Maps

My-Maps is a mobile-first, local-first exploration map. It helps you learn the roads and places around you by making the map itself the progression system.

## V1 foundation

This prototype includes:

- MapLibre rendering with OpenStreetMap raster tiles and a warm, subdued presentation.
- A responsive map-first shell that works on narrow phone widths and desktop.
- A visible hex-sector overlay with an initial exploration percentage surface.
- Live device location when permission is available, with a deterministic starting-area fallback when it is not.
- A current-position marker and a prominent `+` waypoint workflow.
- A waypoint editor with live-follow behavior while the editor is open, name/category fields, and the initial category set.
- Personal waypoint search and the intentionally separate `Search Outside My Map` action.
- Deliberate outside search for addresses and place names using a rate-limited, locally cached Nominatim lookup. Results are map-centered with a temporary marker and OpenStreetMap attribution.
- Local IndexedDB persistence for waypoints, plus storage abstractions for trips and discovered road segments.
- Navigation/exploration placeholders for destination, bearing, distance, and route-mode thresholds.
- An installable PWA manifest and a small offline app-shell service worker.

## Architecture

The app is intentionally a small Vite/React/TypeScript application with one narrow Vercel function for deliberate outside search.

```text
src/
  App.tsx                  Product shell, local state, waypoint workflow
  components/MapCanvas.tsx MapLibre map, current marker, sectors, waypoint markers
  lib/geo.ts               Location fallback, watch helper, small geo utilities
  lib/externalSearch.ts    Outside-search API boundary and local cache
  lib/storage.ts           IndexedDB boundary with an in-memory fallback
  types.ts                 Waypoint, trip, discovery, and coordinate contracts
  styles.css               Responsive visual system and mobile sheet UI
public/
  manifest.webmanifest     Install metadata
  sw.js                    App-shell caching only
  icon.svg                 Lightweight app icon
api/search.js              Minimal Vercel proxy for deliberate geocoding requests
```

`localStore` is the seam for a future sync adapter. Waypoints, trips, and discovered segments are separate records by design: a road can remain discovered permanently even though the individual trip that discovered it is retained as history.

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. On a phone, use a secure deployed URL or a local HTTPS tunnel if you need to test browser geolocation behavior; some browsers restrict geolocation on plain non-localhost HTTP.

Useful checks:

```bash
npm run lint   # TypeScript check
npm run build  # Production bundle
npm run preview
```

## Deploy to Vercel

Import this repository into Vercel using the default Vite settings. The project already has a standard build configuration:

- Install command: `npm install`
- Build command: `npm run build`
- Output directory: `dist`

No environment variables, account system, database, or paid API are required for this milestone. The default map uses OpenStreetMap tiles and the deliberate outside-search action uses the public Nominatim service through the small Vercel function in `api/search.js`. It is intentionally not autocomplete: requests happen only after the user explicitly chooses outside search, are cached locally, and are spaced at least one second apart. Review the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) before broad public traffic or move the lookup to a dedicated geocoding provider.

## Intentionally deferred

The foundation does not include full road-segment matching, trip recording UI, a nationwide road graph, production routing, full offline geographic data, live traffic, accounts, cloud sync, CarPlay, native iOS, or gamification systems such as XP and achievements.

The next milestone should add a small location-to-road-segment pipeline: record a local trip, match GPS points to OpenStreetMap road segments, write discovery records, and redraw an individual trip from history. That will make the subdued/discovered road styling data-driven before adding route scoring.
