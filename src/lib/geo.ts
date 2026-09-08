import type { Coordinates } from '../types'

export const FALLBACK_LOCATION: Coordinates = { lat: 40.7128, lng: -74.006 }
export const HEX_RADIUS_METERS = 780

export function metersPerDegreeLongitude(latitude: number) {
  return Math.cos((latitude * Math.PI) / 180) * 111_000
}

export function distanceBetween(a: Coordinates, b: Coordinates) {
  const metersPerDegreeLat = 111_000
  const metersPerDegreeLng = metersPerDegreeLongitude((a.lat + b.lat) / 2)
  const x = (b.lng - a.lng) * metersPerDegreeLng
  const y = (b.lat - a.lat) * metersPerDegreeLat
  return Math.sqrt(x * x + y * y)
}

export function bearingBetween(a: Coordinates, b: Coordinates) {
  const latitudeA = (a.lat * Math.PI) / 180
  const latitudeB = (b.lat * Math.PI) / 180
  const longitudeDelta = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeB)
  const x = Math.cos(latitudeA) * Math.sin(latitudeB) - Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

export function smoothBearing(previous: number | null, next: number, amount = 0.22) {
  if (previous == null) return next
  const delta = ((next - previous + 540) % 360) - 180
  return (previous + delta * amount + 360) % 360
}

export function compassDirection(degrees: number | null) {
  if (degrees == null || !Number.isFinite(degrees)) return '—'
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(degrees / 45) % 8]
}

export function sectorIdForCoordinate(center: Coordinates, point: Coordinates) {
  const x = (point.lng - center.lng) * metersPerDegreeLongitude(center.lat)
  const y = (point.lat - center.lat) * 111_000
  const row = Math.round(y / (HEX_RADIUS_METERS * 1.48) + 2)
  const column = Math.round(x / (HEX_RADIUS_METERS * 1.72) + 2 - (row % 2 ? 0.5 : 0))
  return `sector:${row}:${column}`
}

export function formatDistance(miles: number) {
  if (miles < 0.1) return '< 0.1 mi'
  return `${miles.toFixed(1)} mi`
}

export function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}_${crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function watchCurrentLocation(
  onSuccess: (location: Coordinates, accuracy?: number, speedMetersPerSecond?: number, headingDegrees?: number) => void,
  onError: (error: GeolocationPositionError) => void,
) {
  if (!('geolocation' in navigator)) return undefined

  return navigator.geolocation.watchPosition(
    (position) => onSuccess(
      { lat: position.coords.latitude, lng: position.coords.longitude },
      position.coords.accuracy,
      position.coords.speed ?? undefined,
      position.coords.heading ?? undefined,
    ),
    onError,
    { enableHighAccuracy: false, maximumAge: 15_000, timeout: 20_000 },
  )
}
