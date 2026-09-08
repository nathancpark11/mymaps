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
- Foreground trip recording with start/end controls, GPS quality filtering, active trace rendering, and simple trip history.
- On-demand local road geometry from OpenStreetMap through a small map-area proxy, cached in IndexedDB by local area.
- Conservative GPS-to-road matching, permanent discovered-segment persistence, discovered-road styling, and calculated sector progress.
- A developer-only diagnostic mode that preserves raw observations and matcher decisions, draws GPS/match overlays, and exports completed trips as readable JSON.
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
  lib/roadData.ts          Road-area loading, cache freshness, and cell merging
  lib/roadMatching.ts      Indexed matcher, thresholds, and structured decisions
  types.ts                 Waypoint, trip, discovery, and coordinate contracts
  styles.css               Responsive visual system and mobile sheet UI
public/
  manifest.webmanifest     Install metadata
  sw.js                    App-shell caching only
  icon.svg                 Lightweight app icon
api/search.js              Minimal Vercel proxy for deliberate geocoding requests
api/roads.js               Small local OpenStreetMap map-area proxy
```

`localStore` is the seam for a future sync adapter. Waypoints, trips, and discovered segments are separate records by design: a road can remain discovered permanently even though the individual trip that discovered it is retained as history.

### Trip and discovery lifecycle

`Start Trip` starts a foreground `watchPosition` session. Accepted GPS points retain latitude, longitude, timestamp, and reported accuracy. `End Trip` stops the watcher and persists a completed `Trip`; the trace remains available in the trip-history list and can be redrawn on the map.

Every foreground GPS callback is retained as a raw `GpsObservation` with a corresponding `MatchDecision`. Only accepted points contribute to the visible trace and distance, and only successful road matches write a `DiscoveredSegment` independently of the trip. Ending, hiding, or eventually deleting a trip will not need to erase permanent discovery state.

When `Developer diagnostics` is enabled in the expanded panel, the map shows raw, accepted, and rejected GPS points plus the current candidate and matched-road geometry. The panel reports coordinates, accuracy, movement, speed, status, rejection reason, candidate distances, ambiguity, matched segment, and continuity. A saved trip can be stepped sample-by-sample and exported with its observations, decisions, thresholds, and relevant road candidates.

### Local road data

The app requests a deliberately small area around the current location (approximately a 2.5 km radius) through `api/roads.js`. The proxy uses the official OpenStreetMap small-area map endpoint, filters the returned XML to drivable `highway` types, and converts OSM ways into JSON road geometry. Normalized OSM ways are split into two-point segments with stable identifiers based on the OSM way ID and endpoint coordinates. Road metadata is cached in IndexedDB using a small geographic cache key, refreshed after seven days, deduplicated while a request is in flight, and merged as the device crosses cache cells so a boundary transition does not silently discard the prior area.

### Matching approach and thresholds

The matcher in `src/lib/roadMatching.ts` uses a lightweight grid index to reduce candidates, point-to-segment distance, reported GPS accuracy, trace continuity, and a connected-segment check at turns. It refuses ambiguous first matches when two roads are too close together, which helps avoid falsely discovering parallel streets.

Current centralized thresholds are:

- Maximum reported accuracy: 50 m.
- Maximum point-to-road distance: 24 m.
- Minimum nearest-candidate separation for an unanchored match: 5 m.
- Stationary point suppression: less than 4 m movement inside 20 seconds.
- Impossible-jump guard: no more than 55 m/s, with a 120 m minimum allowance.

These are intentionally understandable starting values, not a production map-matching engine. GPS can drift beside a road, multipath can reduce accuracy in dense areas, and iOS may pause or delay foreground location updates.

### Real-drive diagnostic workflow

1. Open the deployed PWA on iPhone, allow location access, and enable `Developer diagnostics`.
2. Start a trip while stationary for a few seconds, then drive a known local route containing normal neighborhood roads, an intersection turn, and (if safe) a parallel road, parking lot, driveway, or brief stop.
3. Confirm that live samples update, rejected/stationary points are visible, and the matched road follows the actual drive.
4. End the trip, refresh the app, select it in Trip History, step through several samples, and verify discoveries, road styling, and sector progress remain restored.
5. Review poor-accuracy, stationary, no-road-candidate, ambiguous, jump, and continuity decisions. Export JSON if a mismatch needs deeper review.
6. Collect the route, device/browser, approximate conditions, observed mismatch, raw accuracy, candidate distances, and decision reason before changing any threshold. Tune only the centralized values, then repeat the same route.

Do not inspect the phone while driving. The diagnostic mode is for a passenger or post-drive review; it is intentionally foreground-only and does not run background tracking.

### Sector progress

Each normalized road segment receives a sector ID based on the same local hex coordinate system used by the map overlay. Sector percentage is derived as `discovered road segments / total local road segments * 100`. Sectors with no loaded road geometry remain at 0% rather than inventing progress.

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

This milestone does not include production-grade map matching, background GPS tracking, a nationwide road graph, routing, exploration route scoring, destination guidance, turn-by-turn navigation, full offline geographic data, live traffic, accounts, cloud sync, CarPlay, native iOS, or gamification systems such as XP and achievements. The next milestone should focus on collecting several real-drive traces, comparing decisions against known roads, and tuning thresholds/continuity behavior.

The next milestone should focus on validating the local discovery loop with real drives: improve the road-data refresh strategy, tune thresholds against real GPS traces, and add a small diagnostic view for rejected/ambiguous matches before considering route scoring.
