import { distanceBetween, metersPerDegreeLongitude } from './geo'
import type { Coordinates, RoadSegment, TripPoint } from '../types'

export const MATCHING_THRESHOLDS = {
  maxReportedAccuracyMeters: 50,
  maxRoadDistanceMeters: 24,
  minimumCandidateGapMeters: 5,
  minimumPointMovementMeters: 4,
  stationaryIntervalSeconds: 20,
  maxSpeedMetersPerSecond: 55,
  maxCandidateGridDistance: 2,
}

export type RoadIndex = {
  cells: Map<string, RoadSegment[]>
  cellSizeDegrees: number
}

export type RoadMatch = {
  segment: RoadSegment
  distanceMeters: number
}

type MatchContext = {
  previousPoint?: TripPoint
  previousSegment?: RoadSegment
}

const INDEX_CELL_SIZE_DEGREES = 0.002

function cellKey(latitude: number, longitude: number) {
  return `${Math.floor(latitude / INDEX_CELL_SIZE_DEGREES)}:${Math.floor(longitude / INDEX_CELL_SIZE_DEGREES)}`
}

export function createRoadIndex(segments: RoadSegment[]): RoadIndex {
  const cells = new Map<string, RoadSegment[]>()
  for (const segment of segments) {
    const [a, b] = segment.geometry
    const minLat = Math.min(a.lat, b.lat)
    const maxLat = Math.max(a.lat, b.lat)
    const minLng = Math.min(a.lng, b.lng)
    const maxLng = Math.max(a.lng, b.lng)
    for (let lat = Math.floor(minLat / INDEX_CELL_SIZE_DEGREES); lat <= Math.floor(maxLat / INDEX_CELL_SIZE_DEGREES); lat += 1) {
      for (let lng = Math.floor(minLng / INDEX_CELL_SIZE_DEGREES); lng <= Math.floor(maxLng / INDEX_CELL_SIZE_DEGREES); lng += 1) {
        const key = `${lat}:${lng}`
        const existing = cells.get(key) ?? []
        existing.push(segment)
        cells.set(key, existing)
      }
    }
  }
  return { cells, cellSizeDegrees: INDEX_CELL_SIZE_DEGREES }
}

function candidateSegments(point: Coordinates, index: RoadIndex) {
  const baseLat = Math.floor(point.lat / index.cellSizeDegrees)
  const baseLng = Math.floor(point.lng / index.cellSizeDegrees)
  const candidates = new Map<string, RoadSegment>()
  for (let latOffset = -MATCHING_THRESHOLDS.maxCandidateGridDistance; latOffset <= MATCHING_THRESHOLDS.maxCandidateGridDistance; latOffset += 1) {
    for (let lngOffset = -MATCHING_THRESHOLDS.maxCandidateGridDistance; lngOffset <= MATCHING_THRESHOLDS.maxCandidateGridDistance; lngOffset += 1) {
      for (const segment of index.cells.get(`${baseLat + latOffset}:${baseLng + lngOffset}`) ?? []) candidates.set(segment.segmentId, segment)
    }
  }
  return [...candidates.values()]
}

function pointToSegmentDistance(point: Coordinates, segment: RoadSegment) {
  const [a, b] = segment.geometry
  const metersPerLng = metersPerDegreeLongitude(point.lat)
  const ax = (a.lng - point.lng) * metersPerLng
  const ay = (a.lat - point.lat) * 111_000
  const bx = (b.lng - point.lng) * metersPerLng
  const by = (b.lat - point.lat) * 111_000
  const dx = bx - ax
  const dy = by - ay
  const denominator = dx * dx + dy * dy
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator))
  return Math.sqrt((ax + t * dx) ** 2 + (ay + t * dy) ** 2)
}

function segmentsAreConnected(a: RoadSegment, b: RoadSegment) {
  return a.geometry.some((aPoint) => b.geometry.some((bPoint) => distanceBetween(aPoint, bPoint) <= 22))
}

export function matchPointToRoad(point: TripPoint, index: RoadIndex, context: MatchContext = {}): RoadMatch | null {
  const accuracy = point.accuracyMeters ?? 25
  if (!Number.isFinite(accuracy) || accuracy > MATCHING_THRESHOLDS.maxReportedAccuracyMeters) return null

  const candidates = candidateSegments(point, index)
    .map((segment) => ({ segment, distanceMeters: pointToSegmentDistance(point, segment) }))
    .filter((candidate) => candidate.distanceMeters <= MATCHING_THRESHOLDS.maxRoadDistanceMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
  if (!candidates.length) return null

  if (context.previousPoint) {
    const elapsedSeconds = Math.max(0.1, (Date.parse(point.recordedAt) - Date.parse(context.previousPoint.recordedAt)) / 1_000)
    const movedMeters = distanceBetween(context.previousPoint, point)
    if (movedMeters > Math.max(120, elapsedSeconds * MATCHING_THRESHOLDS.maxSpeedMetersPerSecond)) return null
  }

  const best = candidates[0]
  const second = candidates[1]
  if (context.previousSegment && !segmentsAreConnected(context.previousSegment, best.segment)) {
    const connected = candidates.find((candidate) => segmentsAreConnected(context.previousSegment!, candidate.segment))
    if (connected && connected.distanceMeters <= best.distanceMeters + 8) return connected
    return null
  }
  if (second && second.distanceMeters - best.distanceMeters < MATCHING_THRESHOLDS.minimumCandidateGapMeters && !context.previousSegment) return null
  return best
}

export function shouldAcceptTripPoint(previousPoint: TripPoint | undefined, nextPoint: TripPoint) {
  const accuracy = nextPoint.accuracyMeters ?? 25
  if (!Number.isFinite(nextPoint.lat) || !Number.isFinite(nextPoint.lng)) return false
  if (!Number.isFinite(accuracy) || accuracy > MATCHING_THRESHOLDS.maxReportedAccuracyMeters) return false
  if (!previousPoint) return true

  const elapsedSeconds = Math.max(0.1, (Date.parse(nextPoint.recordedAt) - Date.parse(previousPoint.recordedAt)) / 1_000)
  const movedMeters = distanceBetween(previousPoint, nextPoint)
  if (movedMeters < MATCHING_THRESHOLDS.minimumPointMovementMeters && elapsedSeconds < MATCHING_THRESHOLDS.stationaryIntervalSeconds) return false
  if (movedMeters > Math.max(120, elapsedSeconds * MATCHING_THRESHOLDS.maxSpeedMetersPerSecond)) return false
  return true
}
