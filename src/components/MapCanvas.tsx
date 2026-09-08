import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import type { Coordinates, RoadSegment, Waypoint } from '../types'
import { CATEGORY_EMOJI } from '../types'
import './MapCanvas.css'

type MapCanvasProps = {
  location: Coordinates
  waypoints: Waypoint[]
  roadSegments: RoadSegment[]
  discoveredSegmentIds: string[]
  activeTrace: Coordinates[]
  historicalTrace: Coordinates[]
  sectorStats: Record<string, { totalSegments: number; discoveredSegments: number; percentage: number }>
  externalLocation?: { location: Coordinates; label: string } | null
  isComposingWaypoint: boolean
  onMapReady?: (map: MapLibreMap) => void
}

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
    sectors: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    roads: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    activeTrace: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    historicalTrace: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
  },
  layers: [
    {
      id: 'osm-base',
      type: 'raster',
      source: 'osm',
      paint: {
        'raster-opacity': 0.78,
        'raster-saturation': -0.45,
        'raster-contrast': -0.08,
        'raster-brightness-max': 0.97,
      },
    },
    {
      id: 'sector-fill',
      type: 'fill',
      source: 'sectors',
      paint: {
        'fill-color': ['get', 'fill'],
        'fill-opacity': 0.1,
      },
    },
    {
      id: 'sector-outline',
      type: 'line',
      source: 'sectors',
      paint: {
        'line-color': ['get', 'stroke'],
        'line-width': 1.2,
        'line-opacity': 0.48,
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'roads-unexplored-minor',
      type: 'line',
      source: 'roads',
      filter: ['all', ['==', ['get', 'discovered'], false], ['==', ['get', 'isMajor'], false]],
      paint: {
        'line-color': '#9fb9ae',
        'line-opacity': 0.66,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.7, 16, 2.2],
      },
    },
    {
      id: 'roads-unexplored-major',
      type: 'line',
      source: 'roads',
      filter: ['all', ['==', ['get', 'discovered'], false], ['==', ['get', 'isMajor'], true]],
      paint: {
        'line-color': '#698d82',
        'line-opacity': 0.86,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 4],
      },
    },
    {
      id: 'roads-discovered',
      type: 'line',
      source: 'roads',
      filter: ['==', ['get', 'discovered'], true],
      paint: {
        'line-color': '#e78751',
        'line-opacity': 0.94,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 16, 4.5],
      },
    },
    {
      id: 'historical-trace',
      type: 'line',
      source: 'historicalTrace',
      paint: { 'line-color': '#5f8f86', 'line-width': 3, 'line-opacity': 0.86, 'line-dasharray': [1, 1.5] },
    },
    {
      id: 'active-trace',
      type: 'line',
      source: 'activeTrace',
      paint: { 'line-color': '#dc7746', 'line-width': 4, 'line-opacity': 0.96 },
    },
  ],
}

function hexagon(center: Coordinates, radius: number, row: number, column: number) {
  const latitudeScale = 111_000
  const longitudeScale = Math.cos((center.lat * Math.PI) / 180) * latitudeScale
  const cx = center.lng + ((column + (row % 2 ? 0.5 : 0)) * radius * 1.72) / longitudeScale - (radius * 1.72 * 2) / longitudeScale
  const cy = center.lat + (row * radius * 1.48) / latitudeScale - (radius * 1.48 * 2) / latitudeScale
  const coordinates = Array.from({ length: 7 }, (_, index) => {
    const angle = (Math.PI / 180) * (60 * index + 30)
    return [cx + (Math.cos(angle) * radius) / longitudeScale, cy + (Math.sin(angle) * radius) / latitudeScale]
  })
  return coordinates
}

function sectorData(center: Coordinates, stats: MapCanvasProps['sectorStats']) {
  const features = []
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const sectorId = `sector:${row}:${column}`
      const sectorStats = stats[sectorId]
      const isDiscovered = Boolean(sectorStats?.discoveredSegments)
      features.push({
        type: 'Feature' as const,
        properties: {
          id: sectorId,
          fill: isDiscovered ? '#ee9b61' : '#6fa69a',
          stroke: isDiscovered ? '#d67b46' : '#79a89b',
          exploration: sectorStats?.percentage ?? 0,
          totalSegments: sectorStats?.totalSegments ?? 0,
          discoveredSegments: sectorStats?.discoveredSegments ?? 0,
        },
        geometry: { type: 'Polygon' as const, coordinates: [hexagon(center, 780, row, column)] },
      })
    }
  }
  return { type: 'FeatureCollection' as const, features }
}

function roadData(segments: RoadSegment[], discoveredSegmentIds: string[]) {
  const discovered = new Set(discoveredSegmentIds)
  return {
    type: 'FeatureCollection' as const,
    features: segments.map((segment) => ({
      type: 'Feature' as const,
      properties: {
        segmentId: segment.segmentId,
        discovered: discovered.has(segment.segmentId),
        isMajor: segment.isMajor,
        highway: segment.highway,
      },
      geometry: {
        type: 'LineString' as const,
        coordinates: segment.geometry.map((point) => [point.lng, point.lat]),
      },
    })),
  }
}

function traceData(points: Coordinates[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.length < 2 ? [] : [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: points.map((point) => [point.lng, point.lat]) } }],
  }
}

function createCurrentMarker() {
  const element = document.createElement('div')
  element.className = 'current-location-marker'
  element.innerHTML = '<span class="current-location-pulse"></span><span class="current-location-dot"></span>'
  return element
}

function createWaypointMarker(waypoint: Waypoint) {
  const element = document.createElement('div')
  element.className = 'waypoint-marker'
  element.title = waypoint.name
  element.innerHTML = `<span>${CATEGORY_EMOJI[waypoint.category]}</span>`
  return element
}

function createExternalMarker(label: string) {
  const element = document.createElement('div')
  element.className = 'external-result-marker'
  element.title = label
  element.innerHTML = '<span></span>'
  return element
}

export function MapCanvas({ location, waypoints, roadSegments, discoveredSegmentIds, activeTrace, historicalTrace, sectorStats, externalLocation, isComposingWaypoint, onMapReady }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const currentMarkerRef = useRef<Marker | null>(null)
  const waypointMarkersRef = useRef<Marker[]>([])
  const externalMarkerRef = useRef<Marker | null>(null)
  const locationRef = useRef(location)
  const roadSegmentsRef = useRef(roadSegments)
  const discoveredSegmentIdsRef = useRef(discoveredSegmentIds)
  const activeTraceRef = useRef(activeTrace)
  const historicalTraceRef = useRef(historicalTrace)
  const sectorStatsRef = useRef(sectorStats)
  locationRef.current = location
  roadSegmentsRef.current = roadSegments
  discoveredSegmentIdsRef.current = discoveredSegmentIds
  activeTraceRef.current = activeTrace
  historicalTraceRef.current = historicalTrace
  sectorStatsRef.current = sectorStats
  const onMapReadyRef = useRef(onMapReady)
  onMapReadyRef.current = onMapReady

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [location.lng, location.lat],
      zoom: 13.3,
      minZoom: 3,
      maxZoom: 19,
      attributionControl: false,
      cooperativeGestures: true,
    })

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
    map.on('load', () => {
      ;(map.getSource('sectors') as GeoJSONSource).setData(sectorData(locationRef.current, sectorStatsRef.current))
      ;(map.getSource('roads') as GeoJSONSource).setData(roadData(roadSegmentsRef.current, discoveredSegmentIdsRef.current))
      ;(map.getSource('activeTrace') as GeoJSONSource).setData(traceData(activeTraceRef.current))
      ;(map.getSource('historicalTrace') as GeoJSONSource).setData(traceData(historicalTraceRef.current))
      onMapReadyRef.current?.(map)
    })
    mapRef.current = map

    return () => {
      waypointMarkersRef.current.forEach((marker) => marker.remove())
      currentMarkerRef.current?.remove()
      externalMarkerRef.current?.remove()
      map.remove()
      mapRef.current = null
    }
    // The map should only be created once; location updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    map.easeTo({ center: [location.lng, location.lat], duration: 850, essential: true })
    if (map.isStyleLoaded()) {
      const sectors = map.getSource('sectors') as GeoJSONSource | undefined
      sectors?.setData(sectorData(location, sectorStatsRef.current))
    }

    if (!currentMarkerRef.current) {
      currentMarkerRef.current = new maplibregl.Marker({ element: createCurrentMarker(), anchor: 'center' })
        .setLngLat([location.lng, location.lat])
        .addTo(map)
    } else {
      currentMarkerRef.current.setLngLat([location.lng, location.lat])
    }
  }, [location])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('roads') as GeoJSONSource)?.setData(roadData(roadSegments, discoveredSegmentIds))
  }, [roadSegments, discoveredSegmentIds])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('activeTrace') as GeoJSONSource)?.setData(traceData(activeTrace))
  }, [activeTrace])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('historicalTrace') as GeoJSONSource)?.setData(traceData(historicalTrace))
  }, [historicalTrace])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('sectors') as GeoJSONSource)?.setData(sectorData(location, sectorStats))
  }, [sectorStats, location])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    waypointMarkersRef.current.forEach((marker) => marker.remove())
    waypointMarkersRef.current = waypoints.map((waypoint) =>
      new maplibregl.Marker({ element: createWaypointMarker(waypoint), anchor: 'bottom' })
        .setLngLat([waypoint.location.lng, waypoint.location.lat])
        .addTo(map),
    )
  }, [waypoints])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    externalMarkerRef.current?.remove()
    externalMarkerRef.current = null
    if (externalLocation) {
      externalMarkerRef.current = new maplibregl.Marker({ element: createExternalMarker(externalLocation.label), anchor: 'center' })
        .setLngLat([externalLocation.location.lng, externalLocation.location.lat])
        .addTo(map)
    }
  }, [externalLocation])

  return <div ref={containerRef} className={`map-canvas ${isComposingWaypoint ? 'map-canvas--composing' : ''}`} />
}
