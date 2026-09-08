import type { Coordinates, RoutePlan, RouteStep } from '../types'

type OsrmStep = {
  distance?: number
  duration?: number
  name?: string
  maneuver?: { type?: string; modifier?: string; location?: [number, number] }
}

type OsrmResponse = {
  code?: string
  routes?: Array<{
    distance?: number
    duration?: number
    geometry?: { coordinates?: Array<[number, number]> }
    legs?: Array<{ steps?: OsrmStep[] }>
  }>
}

function instructionForStep(step: OsrmStep) {
  const type = step.maneuver?.type ?? 'continue'
  const modifier = step.maneuver?.modifier?.replace('-', ' ') ?? ''
  const roadName = step.name ? ` onto ${step.name}` : ''
  if (type === 'depart') return step.name ? `Start on ${step.name}` : 'Start driving'
  if (type === 'arrive') return 'Arrive at your destination'
  if (type === 'roundabout' || type === 'rotary') return step.name ? `Enter the roundabout${roadName}` : 'Enter the roundabout'
  if (type === 'merge') return `Merge${roadName}`
  if (type === 'on ramp') return `Take the ramp${roadName}`
  if (type === 'off ramp') return `Take the exit${roadName}`
  if (type === 'fork') return `Keep ${modifier || 'straight'}${roadName}`
  if (type === 'new name') return step.name ? `Continue onto ${step.name}` : 'Continue ahead'
  if (type === 'end of road') return `Turn ${modifier || 'ahead'}${roadName}`
  if (type === 'turn') return `Turn ${modifier || 'ahead'}${roadName}`
  return step.name ? `Continue onto ${step.name}` : 'Continue ahead'
}

function normalizeStep(step: OsrmStep): RouteStep {
  const location = step.maneuver?.location ?? [0, 0]
  return {
    instruction: instructionForStep(step),
    distanceMeters: step.distance ?? 0,
    durationSeconds: step.duration ?? 0,
    location: { lng: location[0], lat: location[1] },
  }
}

export async function requestRoute(start: Coordinates, destination: Coordinates, signal?: AbortSignal): Promise<RoutePlan> {
  const params = new URLSearchParams({
    startLat: start.lat.toFixed(6),
    startLng: start.lng.toFixed(6),
    endLat: destination.lat.toFixed(6),
    endLng: destination.lng.toFixed(6),
  })
  const response = await fetch(`/api/route?${params.toString()}`, { signal })
  const payload = await response.json() as OsrmResponse & { error?: string }
  if (!response.ok || payload.code !== 'Ok' || !payload.routes?.[0]) throw new Error(payload.error || 'Route unavailable')
  const route = payload.routes[0]
  const geometry = (route.geometry?.coordinates ?? []).map(([lng, lat]) => ({ lng, lat }))
  const steps = (route.legs ?? []).flatMap((leg) => (leg.steps ?? []).map(normalizeStep))
  if (geometry.length < 2) throw new Error('Route geometry was empty')
  return {
    geometry,
    steps,
    distanceMeters: route.distance ?? 0,
    durationSeconds: route.duration ?? 0,
  }
}
