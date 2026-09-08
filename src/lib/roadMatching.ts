import { distanceBetween, metersPerDegreeLongitude } from './geo'
import type { Coordinates, MatchDecision, RoadSegment, TripPoint } from '../types'

// Keep these values together: field validation should tune this module, not UI code.
export const MATCHING_THRESHOLDS = {
  maxReportedAccuracyMeters: 50,
  maxRoadDistanceMeters: 24,
  minimumCandidateGapMeters: 5,
  minimumPointMovementMeters: 4,
  stationaryIntervalSeconds: 20,
  maxSpeedMetersPerSecond: 55,
  minimumJumpAllowanceMeters: 120,
  connectedEndpointToleranceMeters: 22,
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

export type MatchContext = {
  previousPoint?: TripPoint
  previousSegment?: RoadSegment
}

export type PointEvaluation = {
  decision: Omit<MatchDecision, 'observationId'>
  match?: RoadMatch
  candidateSegments: RoadSegment[]
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

export function pointToSegmentDistance(point: Coordinates, segment: RoadSegment) {
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

export function segmentsAreConnected(a: RoadSegment, b: RoadSegment) {
  return a.geometry.some((aPoint) => b.geometry.some((bPoint) => distanceBetween(aPoint, bPoint) <= MATCHING_THRESHOLDS.connectedEndpointToleranceMeters))
}

function movementDetails(previousPoint: TripPoint | undefined, point: TripPoint) {
  if (!previousPoint) return {}
  const elapsedSeconds = Math.max(0.1, (Date.parse(point.recordedAt) - Date.parse(previousPoint.recordedAt)) / 1_000)
  const movementDistanceMeters = distanceBetween(previousPoint, point)
  return { movementDistanceMeters, movementSpeedMetersPerSecond: movementDistanceMeters / elapsedSeconds, elapsedSeconds }
}

function qualityDecision(point: TripPoint, previousPoint?: TripPoint): PointEvaluation['decision'] {
  const movement = movementDetails(previousPoint, point)
  const base = {
    acceptedPoint: true,
    status: 'accepted' as const,
    candidateCount: 0,
    candidateSegmentIds: [],
    ambiguous: false,
    continuityAffected: false,
    ...movement,
  }
  const accuracy = point.accuracyMeters ?? 25
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return { ...base, acceptedPoint: false, status: 'rejected', rejectionReason: 'invalid-coordinate' }
  if (!Number.isFinite(accuracy) || accuracy > MATCHING_THRESHOLDS.maxReportedAccuracyMeters) return { ...base, acceptedPoint: false, status: 'rejected', rejectionReason: `poor-accuracy-over-${MATCHING_THRESHOLDS.maxReportedAccuracyMeters}m` }
  if (previousPoint && (movement.movementDistanceMeters ?? 0) < MATCHING_THRESHOLDS.minimumPointMovementMeters && (movement.elapsedSeconds ?? 0) < MATCHING_THRESHOLDS.stationaryIntervalSeconds) {
    return { ...base, acceptedPoint: false, status: 'stationary', rejectionReason: `stationary-under-${MATCHING_THRESHOLDS.minimumPointMovementMeters}m` }
  }
  if (previousPoint && (movement.movementDistanceMeters ?? 0) > Math.max(MATCHING_THRESHOLDS.minimumJumpAllowanceMeters, (movement.elapsedSeconds ?? 0) * MATCHING_THRESHOLDS.maxSpeedMetersPerSecond)) {
    return { ...base, acceptedPoint: false, status: 'rejected', rejectionReason: `impossible-jump-over-${MATCHING_THRESHOLDS.maxSpeedMetersPerSecond}mps` }
  }
  return base
}

export function evaluateTripPoint(point: TripPoint, index: RoadIndex | null, context: MatchContext = {}): PointEvaluation {
  const quality = qualityDecision(point, context.previousPoint)
  if (!quality.acceptedPoint) return { decision: quality, candidateSegments: [] }
  if (!index) return { decision: { ...quality, matchRejectionReason: 'no-road-data-loaded' }, candidateSegments: [] }

  const candidates = candidateSegments(point, index)
    .map((segment) => ({ segment, distanceMeters: pointToSegmentDistance(point, segment) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
  const nearest = candidates[0]
  const second = candidates[1]
  const withinRange = candidates.filter((candidate) => candidate.distanceMeters <= MATCHING_THRESHOLDS.maxRoadDistanceMeters)
  const diagnostics = {
    candidateCount: candidates.length,
    candidateSegmentIds: candidates.slice(0, 8).map((candidate) => candidate.segment.segmentId),
    nearestCandidateDistanceMeters: nearest?.distanceMeters,
    secondNearestCandidateDistanceMeters: second?.distanceMeters,
  }
  if (!withinRange.length) return { decision: { ...quality, ...diagnostics, matchRejectionReason: 'no-road-candidate-within-threshold' }, candidateSegments: candidates.slice(0, 8).map((candidate) => candidate.segment) }

  let best = withinRange[0]
  let continuityAffected = false
  let continuityReason: string | undefined
  if (context.previousSegment && !segmentsAreConnected(context.previousSegment, best.segment)) {
    const connected = withinRange.find((candidate) => segmentsAreConnected(context.previousSegment!, candidate.segment))
    continuityAffected = true
    if (connected && connected.distanceMeters <= best.distanceMeters + 8) {
      best = connected
      continuityReason = 'selected-connected-segment-over-nearest-candidate'
    } else {
      return {
        decision: { ...quality, ...diagnostics, continuityAffected, continuityReason: 'nearest-candidate-disconnected-from-previous-segment', matchRejectionReason: 'disconnected-from-previous-segment' },
        candidateSegments: candidates.slice(0, 8).map((candidate) => candidate.segment),
      }
    }
  }

  const ambiguous = !context.previousSegment && Boolean(second && second.distanceMeters - best.distanceMeters < MATCHING_THRESHOLDS.minimumCandidateGapMeters)
  if (ambiguous) {
    return {
      decision: { ...quality, ...diagnostics, ambiguous: true, matchRejectionReason: `candidate-gap-under-${MATCHING_THRESHOLDS.minimumCandidateGapMeters}m` },
      candidateSegments: candidates.slice(0, 8).map((candidate) => candidate.segment),
    }
  }

  return {
    decision: { ...quality, ...diagnostics, matchedSegmentId: best.segment.segmentId, matchedRoadName: best.segment.name, matchDistanceMeters: best.distanceMeters, continuityAffected, continuityReason },
    match: best,
    candidateSegments: candidates.slice(0, 8).map((candidate) => candidate.segment),
  }
}

export function matchPointToRoad(point: TripPoint, index: RoadIndex, context: MatchContext = {}) {
  return evaluateTripPoint(point, index, context).match ?? null
}

export function shouldAcceptTripPoint(previousPoint: TripPoint | undefined, nextPoint: TripPoint) {
  return qualityDecision(nextPoint, previousPoint).acceptedPoint
}

export function decisionWithObservationId(observationId: string, evaluation: PointEvaluation['decision']): MatchDecision {
  return { observationId, ...evaluation }
}
