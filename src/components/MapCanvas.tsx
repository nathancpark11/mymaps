import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import type { Coordinates, Waypoint } from '../types'
import { CATEGORY_EMOJI } from '../types'
import './MapCanvas.css'

type MapCanvasProps = {
  location: Coordinates
  waypoints: Waypoint[]
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

function sectorData(center: Coordinates) {
  const features = []
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const isDiscovered = row === 2 && column === 2
      features.push({
        type: 'Feature' as const,
        properties: {
          fill: isDiscovered ? '#ee9b61' : '#6fa69a',
          stroke: isDiscovered ? '#d67b46' : '#79a89b',
          exploration: isDiscovered ? 34 : row === 2 && column === 3 ? 12 : 0,
        },
        geometry: { type: 'Polygon' as const, coordinates: [hexagon(center, 780, row, column)] },
      })
    }
  }
  return { type: 'FeatureCollection' as const, features }
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

export function MapCanvas({ location, waypoints, isComposingWaypoint, onMapReady }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const currentMarkerRef = useRef<Marker | null>(null)
  const waypointMarkersRef = useRef<Marker[]>([])
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
      const sectors = map.getSource('sectors') as GeoJSONSource
      sectors.setData(sectorData(location))
      onMapReadyRef.current?.(map)
    })
    mapRef.current = map

    return () => {
      waypointMarkersRef.current.forEach((marker) => marker.remove())
      currentMarkerRef.current?.remove()
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
      sectors?.setData(sectorData(location))
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
    if (!map) return
    waypointMarkersRef.current.forEach((marker) => marker.remove())
    waypointMarkersRef.current = waypoints.map((waypoint) =>
      new maplibregl.Marker({ element: createWaypointMarker(waypoint), anchor: 'bottom' })
        .setLngLat([waypoint.location.lng, waypoint.location.lat])
        .addTo(map),
    )
  }, [waypoints])

  return <div ref={containerRef} className={`map-canvas ${isComposingWaypoint ? 'map-canvas--composing' : ''}`} />
}
