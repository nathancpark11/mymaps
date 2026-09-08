import type { Coordinates } from '../types'

export const FALLBACK_LOCATION: Coordinates = { lat: 40.7128, lng: -74.006 }

export function formatDistance(miles: number) {
  if (miles < 0.1) return '< 0.1 mi'
  return `${miles.toFixed(1)} mi`
}

export function makeId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}_${crypto.randomUUID()}`
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export function watchCurrentLocation(
  onSuccess: (location: Coordinates, accuracy?: number) => void,
  onError: (error: GeolocationPositionError) => void,
) {
  if (!('geolocation' in navigator)) return undefined

  return navigator.geolocation.watchPosition(
    (position) => onSuccess({ lat: position.coords.latitude, lng: position.coords.longitude }, position.coords.accuracy),
    onError,
    { enableHighAccuracy: false, maximumAge: 15_000, timeout: 20_000 },
  )
}
