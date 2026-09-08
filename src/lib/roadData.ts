import { distanceBetween, FALLBACK_LOCATION, sectorIdForCoordinate } from './geo'
import { localStore } from './storage'
import type { Coordinates, RoadDataCache, RoadSegment } from '../types'

export const ROAD_DATA_RADIUS_METERS = 2_500
const ROAD_CACHE_GRID_DEGREES = 0.02
const MAJOR_HIGHWAYS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary'])

type OverpassElement = {
  type: 'way'
  id: number
  tags?: { highway?: string; name?: string }
  geometry?: Array<{ lat: number; lon: number }>
}

type OverpassResponse = { elements?: OverpassElement[] }

export function roadCacheKey(location: Coordinates) {
  const gridLat = Math.floor(location.lat / ROAD_CACHE_GRID_DEGREES)
  const gridLng = Math.floor(location.lng / ROAD_CACHE_GRID_DEGREES)
  return `${gridLat}:${gridLng}`
}

export function roadBbox(location: Coordinates) {
  const latDelta = ROAD_DATA_RADIUS_METERS / 111_000
  const lngDelta = ROAD_DATA_RADIUS_METERS / (Math.cos((location.lat * Math.PI) / 180) * 111_000)
  return {
    minLat: location.lat - latDelta,
    minLng: location.lng - lngDelta,
    maxLat: location.lat + latDelta,
    maxLng: location.lng + lngDelta,
  }
}

function coordinateKey(point: Coordinates) {
  return `${point.lat.toFixed(6)}:${point.lng.toFixed(6)}`
}

function segmentId(wayId: number, a: Coordinates, b: Coordinates) {
  const ends = [coordinateKey(a), coordinateKey(b)].sort()
  return `osm-way:${wayId}:${ends[0]}:${ends[1]}`
}

export function normalizeRoadData(payload: OverpassResponse, center: Coordinates): RoadSegment[] {
  const output: RoadSegment[] = []
  for (const way of payload.elements ?? []) {
    const highway = way.tags?.highway
    if (!highway || !way.geometry || way.geometry.length < 2) continue
    for (let index = 0; index < way.geometry.length - 1; index += 1) {
      const a = { lat: way.geometry[index].lat, lng: way.geometry[index].lon }
      const b = { lat: way.geometry[index + 1].lat, lng: way.geometry[index + 1].lon }
      if (distanceBetween(a, b) < 2) continue
      output.push({
        segmentId: segmentId(way.id, a, b),
        osmWayId: way.id,
        geometry: [a, b],
        highway,
        name: way.tags?.name,
        sectorId: sectorIdForCoordinate(center, { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }),
        isMajor: MAJOR_HIGHWAYS.has(highway),
      })
    }
  }
  return output
}

export async function loadRoadData(location: Coordinates): Promise<RoadDataCache> {
  const cacheKey = roadCacheKey(location)
  const cached = await localStore.getRoadData(cacheKey)
  if (cached) return cached

  const bbox = roadBbox(location)
  const params = new URLSearchParams({
    minLat: bbox.minLat.toFixed(5),
    minLng: bbox.minLng.toFixed(5),
    maxLat: bbox.maxLat.toFixed(5),
    maxLng: bbox.maxLng.toFixed(5),
  })
  const response = await fetch(`/api/roads?${params.toString()}`)
  if (!response.ok) throw new Error(`Road data request failed with status ${response.status}`)
  const payload = await response.json() as OverpassResponse
  const roadData: RoadDataCache = {
    cacheKey,
    center: location,
    fetchedAt: new Date().toISOString(),
    segments: normalizeRoadData(payload, location),
  }
  await localStore.saveRoadData(roadData)
  return roadData
}

export function emptyRoadData(): RoadDataCache {
  return { cacheKey: roadCacheKey(FALLBACK_LOCATION), center: FALLBACK_LOCATION, fetchedAt: new Date(0).toISOString(), segments: [] }
}
