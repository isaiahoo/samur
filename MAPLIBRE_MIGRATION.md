# MapLibre GL JS Migration Plan

## Leaflet → MapLibre GL JS + MapTiler (Vector Tiles)

**Goal**: Replace raster map stack (Leaflet + OSM PNG tiles) with vector tile stack (MapLibre GL + MapTiler/OpenFreeMap/PMTiles) for better 3G performance, GPU rendering, and offline capability.

**Current state**: 4 Leaflet files in PWA, 2 in VK app, plus shared constants and vite configs.

---

## Phase 1: Dependencies & Cleanup

### 1.1 Remove Leaflet dependencies

**apps/pwa/package.json** — remove:
- `leaflet`, `react-leaflet`, `leaflet.markercluster` (dependencies)
- `@types/leaflet`, `@types/leaflet.markercluster` (devDependencies)

**apps/vk/package.json** — remove:
- `leaflet`, `react-leaflet` (dependencies)
- `@types/leaflet` (devDependencies)

### 1.2 Install MapLibre dependencies

**apps/pwa/package.json** — add:
- `maplibre-gl` (latest stable)
- `pmtiles` (for offline tile protocol)

**apps/vk/package.json** — add:
- `maplibre-gl` (latest stable)

### 1.3 Update Vite configs

**apps/pwa/vite.config.ts**:
- Replace `leaflet` manual chunk with `maplibre` chunk: `{ maplibre: ["maplibre-gl"] }`
- Update workbox runtimeCaching: remove OSM tile pattern, add tile proxy pattern `/api/v1/tiles/`
- Add `maplibre-gl` to `optimizeDeps.include`

**apps/vk/vite.config.ts**:
- Replace `leaflet` manual chunk with `maplibre` chunk

### 1.4 Update CSS

**apps/pwa/src/index.css**:
- Remove `.custom-marker`, `.leaflet-popup-content-wrapper`, `.leaflet-popup-content` rules
- Add `@import 'maplibre-gl/dist/maplibre-gl.css';` (or add to main.tsx)
- Add MapLibre popup styling (`.maplibregl-popup-content`)

---

## Phase 2: Backend Tile Proxy

### 2.1 Tile proxy endpoint

**New file: apps/api/src/routes/tiles.ts**

```
GET /api/v1/tiles/:z/:x/:y.pbf
```

- Reads `TILE_PROVIDER` env var (`maptiler` | `openfreemap`, default: `openfreemap`)
- **MapTiler**: proxies to `https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key=${MAPTILER_API_KEY}`
- **OpenFreeMap**: proxies to `https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf`
- Sets `Cache-Control: public, max-age=86400` (1 day) on responses
- No auth required (public endpoint)
- Streams response body (pipe, don't buffer)
- On upstream error: returns 502 with empty body

### 2.2 MapTiler style proxy

**Same file: apps/api/src/routes/tiles.ts**

```
GET /api/v1/tiles/style.json
```

- Returns MapLibre style JSON with tile source pointing to our proxy
- Dynamically constructs style based on `TILE_PROVIDER`
- Includes font/sprite URLs (from MapTiler or self-hosted)

### 2.3 Environment variables

**.env.example** — add:
```
MAPTILER_API_KEY=""
TILE_PROVIDER="openfreemap"
```

### 2.4 Mount route

**apps/api/src/index.ts** — add:
```ts
import { tilesRouter } from "./routes/tiles.js";
app.use("/api/v1/tiles", tilesRouter);
```

---

## Phase 3: PWA Map Component Rewrite

### 3.1 Replace MarkerIcons.ts

**Rewrite: apps/pwa/src/components/map/MarkerIcons.ts**

- Remove all Leaflet `L.divIcon` usage
- Export GeoJSON-compatible helper functions instead
- Define color maps and symbol maps as plain objects
- Export `getIncidentColor(severity)`, `getHelpColor(type)`, `getShelterColor(status)`, `getRiverColor(level, danger)` functions
- These return `{ color: string, symbol: string }` for use in MapLibre expressions

### 3.2 Rewrite MapView.tsx

**Rewrite: apps/pwa/src/components/map/MapView.tsx**

Remove all react-leaflet imports. Build with vanilla MapLibre GL JS + React refs.

**Map initialization**:
```tsx
const mapRef = useRef<maplibregl.Map | null>(null);
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const map = new maplibregl.Map({
    container: containerRef.current!,
    style: "/api/v1/tiles/style.json",
    center: [MAKHACHKALA_CENTER.lng, MAKHACHKALA_CENTER.lat], // note: lng,lat order
    zoom: 11,
    attributionControl: false,
  });
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }));
  mapRef.current = map;
  return () => map.remove();
}, []);
```

**Data layers** (added on `map.on('load')`):

1. **Incidents layer** — GeoJSON source with clustering:
   ```
   source: { type: "geojson", data: incidentsGeoJSON, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 }
   ```
   - `incidents-clusters` layer (type: circle) for cluster circles, sized by `point_count`
   - `incidents-cluster-count` layer (type: symbol) showing count text
   - `incidents-unclustered` layer (type: circle) with `match` expression on `severity` for color

2. **Help requests layer** — GeoJSON source with clustering:
   - `help-clusters` layer (type: circle)
   - `help-unclustered` layer (type: circle) with color by `type` (need=red, offer=green)

3. **Shelters layer** — GeoJSON source (no clustering):
   - `shelters` layer (type: circle) with color by `status` (open=green, full=gray, closed=red)

4. **River levels layer** — GeoJSON source (no clustering):
   - `rivers` layer (type: circle) with data-driven color based on level/danger ratio

5. **Flood zones layer** (future-ready):
   - `flood-zones` layer (type: fill) with semi-transparent blue (`#3b82f680`)
   - Empty GeoJSON source initially

**Click handlers**:
```ts
map.on('click', 'incidents-unclustered', (e) => {
  const feature = e.features?.[0];
  if (feature) onMarkerClick("incident", feature.properties);
});
// Same pattern for each layer
```

**Cluster expansion**:
```ts
map.on('click', 'incidents-clusters', (e) => {
  const source = map.getSource('incidents') as GeoJSONSource;
  source.getClusterExpansionZoom(feature.properties.cluster_id, (err, zoom) => {
    map.easeTo({ center: feature.geometry.coordinates, zoom });
  });
});
```

**Layer visibility toggle**:
```ts
// When layers prop changes:
map.setLayoutProperty('incidents-unclustered', 'visibility', layers.incidents ? 'visible' : 'none');
map.setLayoutProperty('incidents-clusters', 'visibility', layers.incidents ? 'visible' : 'none');
// etc.
```

**Bounds tracking** (replaces MapEventHandler):
```ts
map.on('moveend', () => {
  const b = map.getBounds();
  onMapMove?.({ north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, map.getZoom());
});
```

**Popups**:
```ts
const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '240px' });
map.on('click', 'incidents-unclustered', (e) => {
  const props = e.features[0].properties;
  popup.setLngLat(e.lngLat).setHTML(`<div class="popup-content">...</div>`).addTo(map);
});
```

### 3.3 GeoJSON conversion helpers

**New file: apps/pwa/src/components/map/geoJsonHelpers.ts**

Convert API response arrays to GeoJSON FeatureCollections:
```ts
export function toIncidentsGeoJSON(incidents: Incident[]): GeoJSON.FeatureCollection
export function toHelpRequestsGeoJSON(helpRequests: HelpRequest[]): GeoJSON.FeatureCollection
export function toSheltersGeoJSON(shelters: Shelter[]): GeoJSON.FeatureCollection
export function toRiverLevelsGeoJSON(riverLevels: RiverLevel[]): GeoJSON.FeatureCollection
```

Each feature carries all properties needed for popups and data-driven styling in `feature.properties`.

### 3.4 Update MapPage.tsx

**Edit: apps/pwa/src/pages/MapPage.tsx**

Minimal changes — MapView props interface stays the same. Main change:
- The GPS button can be removed (MapLibre's GeolocateControl replaces it)
- Import path stays the same

### 3.5 Update LayerToggle.tsx

No changes needed — it doesn't depend on Leaflet.

### 3.6 Update ReportForm.tsx

Check for any Leaflet imports — if none, no changes needed.

---

## Phase 4: VK Mini App Map Rewrite

### 4.1 Replace VK MarkerIcons.ts

**Rewrite: apps/vk/src/components/MarkerIcons.ts**

- Remove Leaflet imports
- Export color/symbol maps as plain objects (same as PWA but simpler)

### 4.2 Rewrite MapPanel.tsx

**Rewrite: apps/vk/src/panels/MapPanel.tsx**

Same MapLibre approach as PWA but simplified:
- No clustering (smaller dataset, limit=100)
- No river levels layer
- No layer toggles
- FAB button stays the same (positioned absolutely over map)
- Use inline style for map container: `height: calc(100vh - 96px)`

```tsx
useEffect(() => {
  const map = new maplibregl.Map({
    container: containerRef.current!,
    style: "/api/v1/tiles/style.json",
    center: [MAKHACHKALA_CENTER.lng, MAKHACHKALA_CENTER.lat],
    zoom: 11,
    attributionControl: false,
  });

  map.on('load', () => {
    // Add incidents, helpRequests, shelters as GeoJSON sources + circle layers
  });

  mapRef.current = map;
  return () => map.remove();
}, []);

// Update sources when data changes
useEffect(() => {
  const map = mapRef.current;
  if (!map || !map.isStyleLoaded()) return;
  (map.getSource('incidents') as GeoJSONSource)?.setData(toIncidentsGeoJSON(incidents));
}, [incidents]);
```

---

## Phase 5: Tile Proxy & Style Configuration

### 5.1 Backend style.json endpoint

The style JSON defines the visual appearance of vector tiles. Structure:

```json
{
  "version": 8,
  "name": "Samur",
  "sources": {
    "openmaptiles": {
      "type": "vector",
      "tiles": ["/api/v1/tiles/{z}/{x}/{y}.pbf"],
      "maxzoom": 14
    }
  },
  "layers": [
    // Background, water, landuse, roads, buildings, labels
    // Use standard OpenMapTiles schema layer definitions
  ]
}
```

For MapTiler: can use their pre-built style and rewrite source URLs.
For OpenFreeMap: use their compatible style with rewritten source URLs.

### 5.2 Light/dark map styles

Both OpenFreeMap and MapTiler support multiple styles. Start with a single "positron" (light) style. The style.json endpoint can accept a `?theme=light|dark` query param for future use.

---

## Phase 6: Offline Support (PMTiles)

### 6.1 PMTiles file generation

**One-time setup (not in code)**:
1. Download Russia extract from Protomaps builds
2. Clip to Dagestan bbox: `pmtiles extract russia.pmtiles dagestan.pmtiles --bbox=45.0,41.1,48.6,44.3`
3. Expected size: ~50-150MB for the region
4. Place file at `apps/api/public/dagestan.pmtiles` or serve from static volume

### 6.2 PMTiles static serving

**apps/api/src/routes/tiles.ts** — add:
```
GET /api/v1/tiles/offline/dagestan.pmtiles
```
- Serves the PMTiles file with `Accept-Ranges: bytes` support (required for range requests)
- Or use express.static with the file

### 6.3 PWA integration

**apps/pwa/src/components/map/MapView.tsx**:
```ts
import { Protocol } from "pmtiles";

// Register PMTiles protocol before creating map
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
```

**Service worker strategy** (apps/pwa/vite.config.ts workbox config):
- Cache tile proxy responses (`/api/v1/tiles/*.pbf`) with CacheFirst, 7-day expiration
- Progressive caching: tiles are cached as user browses
- No full PMTiles pre-cache (too large for service worker)
- Fallback: if network and cache miss, MapLibre shows blank tiles gracefully

### 6.4 Offline tile fallback in style.json

When frontend detects offline (via `navigator.onLine` or failed tile fetch):
- Switch map style source to PMTiles URL: `pmtiles:///api/v1/tiles/offline/dagestan.pmtiles`
- PMTiles protocol handles range requests from cached file or network

---

## Phase 7: Docker & Environment Updates

### 7.1 Docker Compose

**docker-compose.prod.yml** — add PMTiles volume:
```yaml
api:
  volumes:
    - ./data/tiles:/app/tiles:ro
```

### 7.2 Environment

**.env.example**:
```
MAPTILER_API_KEY=""
TILE_PROVIDER="openfreemap"    # maptiler | openfreemap
```

### 7.3 Server deployment

After code is pushed:
1. Download/generate dagestan.pmtiles
2. Place in `/opt/samur/data/tiles/dagestan.pmtiles`
3. Rebuild API container
4. Update nginx config if tile paths need proxying

---

## Phase 8: Testing & Validation

### 8.1 Manual testing checklist

- [ ] Map loads with vector tiles (not raster)
- [ ] Incidents display with correct severity colors
- [ ] Help requests display with need/offer distinction
- [ ] Shelters display with status colors
- [ ] River levels display with danger-level colors
- [ ] Clustering works for incidents and help requests
- [ ] Click on cluster expands/zooms
- [ ] Click on marker opens popup with correct data
- [ ] Layer toggles show/hide correctly
- [ ] Real-time Socket.IO updates add/update markers
- [ ] GeolocateControl shows user position
- [ ] Report form still works
- [ ] VK Mini App map loads and displays data
- [ ] Tile proxy returns .pbf tiles correctly
- [ ] Offline: cached tiles display when network unavailable
- [ ] PMTiles protocol loads tiles from local file
- [ ] No Leaflet code or CSS remains in bundle

### 8.2 Performance validation

- [ ] Initial map load under 3 seconds on 3G
- [ ] Map interaction smooth (60fps panning/zooming)
- [ ] 500+ markers render without lag
- [ ] Bundle size reduction vs Leaflet version

---

## Implementation Order

| Step | Phase | Description | Files |
|------|-------|-------------|-------|
| 1 | 2.1-2.4 | Backend tile proxy + style.json | `apps/api/src/routes/tiles.ts`, `apps/api/src/index.ts`, `.env.example` |
| 2 | 1.1-1.2 | Swap npm dependencies | `apps/pwa/package.json`, `apps/vk/package.json` |
| 3 | 1.3 | Update Vite configs | `apps/pwa/vite.config.ts`, `apps/vk/vite.config.ts` |
| 4 | 3.3 | GeoJSON helpers | `apps/pwa/src/components/map/geoJsonHelpers.ts` |
| 5 | 3.1 | Rewrite PWA MarkerIcons | `apps/pwa/src/components/map/MarkerIcons.ts` |
| 6 | 3.2 | Rewrite PWA MapView | `apps/pwa/src/components/map/MapView.tsx` |
| 7 | 3.4 | Update MapPage | `apps/pwa/src/pages/MapPage.tsx` |
| 8 | 1.4 | Update CSS | `apps/pwa/src/index.css` |
| 9 | 4.1-4.2 | Rewrite VK map | `apps/vk/src/components/MarkerIcons.ts`, `apps/vk/src/panels/MapPanel.tsx` |
| 10 | 6.1-6.4 | PMTiles offline support | `apps/pwa/src/components/map/MapView.tsx`, service worker |
| 11 | 7.1-7.3 | Docker & env updates | `docker-compose.prod.yml`, `.env.example` |
| 12 | 8.1-8.2 | Testing | Manual verification |

---

## Notes

- **MapLibre uses [lng, lat] order** (opposite of Leaflet's [lat, lng]). This affects every coordinate in the codebase.
- **No react-leaflet equivalent**: We use vanilla MapLibre GL JS with React refs. No wrapper library needed — the API is clean enough.
- **Clustering is native**: MapLibre's GeoJSON source has built-in clustering. No plugin needed (replaces leaflet.markercluster).
- **Data-driven styling**: Colors per severity/status are expressed as MapLibre `match` expressions in layer paint properties, not per-marker icons.
- **OpenFreeMap** uses OpenMapTiles schema, same as MapTiler — styles are compatible between providers.
- **Bundle size**: maplibre-gl (~300KB gzipped) vs leaflet+react-leaflet+cluster (~80KB gzipped). Larger library but renders much faster with many markers.
