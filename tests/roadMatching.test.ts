import { describe, expect, it } from 'vitest'
import type { RoadSegment, TripPoint } from '../src/types'
import { createRoadIndex, evaluateTripPoint, matchPointToRoad, shouldAcceptTripPoint } from '../src/lib/roadMatching'
import { roadBbox, roadCacheKey } from '../src/lib/roadData'

function segment(segmentId: string, a: [number, number], b: [number, number], highway = 'residential', name?: string): RoadSegment {
  return {
    segmentId,
    osmWayId: Number(segmentId.replace(/\D/g, '')) || 1,
    geometry: [{ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }],
    highway,
    name,
    sectorId: 'sector:2:2',
    isMajor: false,
  }
}

function point(lat: number, lng: number, seconds: number, accuracyMeters = 5): TripPoint {
  return { lat, lng, accuracyMeters, recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString() }
}

describe('GPS road matching diagnostics', () => {
  it('matches points directly following a road', () => {
    const road = segment('road-1', [40.7, -74.01], [40.7, -73.99], 'residential', 'Main Street')
    const index = createRoadIndex([road])
    expect(matchPointToRoad(point(40.70001, -74.005, 0), index)?.segment.segmentId).toBe('road-1')
    expect(evaluateTripPoint(point(40.70001, -74.005, 0), index).decision.matchedRoadName).toBe('Main Street')
  })

  it('does not choose an adjacent parallel road when the traveled road is clear', () => {
    const traveled = segment('road-1', [40.7, -74.01], [40.7, -73.99])
    const parallel = segment('road-2', [40.70011, -74.01], [40.70011, -73.99])
    const evaluation = evaluateTripPoint(point(40.70001, -74.005, 0), createRoadIndex([traveled, parallel]))
    expect(evaluation.match?.segment.segmentId).toBe('road-1')
    expect(evaluation.decision.candidateCount).toBe(2)
  })

  it('rejects an alongside reading beyond the road threshold', () => {
    const road = segment('road-1', [40.7, -74.01], [40.7, -73.99])
    const evaluation = evaluateTripPoint(point(40.70035, -74.005, 0), createRoadIndex([road]))
    expect(evaluation.match).toBeUndefined()
    expect(evaluation.decision.matchRejectionReason).toBe('no-road-candidate-within-threshold')
    expect(evaluation.decision.nearestCandidateDistanceMeters).toBeGreaterThan(24)
  })

  it('allows a connected turn at an intersection', () => {
    const eastWest = segment('road-1', [40.7, -74.01], [40.7, -74])
    const northSouth = segment('road-2', [40.7, -74], [40.71, -74])
    const index = createRoadIndex([eastWest, northSouth])
    const evaluation = evaluateTripPoint(point(40.701, -74, 5), index, { previousPoint: point(40.7, -74.001, 0), previousSegment: eastWest })
    expect(evaluation.match?.segment.segmentId).toBe('road-2')
  })

  it('reports ambiguity when two candidate roads are too close', () => {
    const first = segment('road-1', [40.7, -74.01], [40.7, -73.99])
    const second = segment('road-2', [40.70003, -74.01], [40.70003, -73.99])
    const evaluation = evaluateTripPoint(point(40.700015, -74.005, 0), createRoadIndex([first, second]))
    expect(evaluation.match).toBeUndefined()
    expect(evaluation.decision.ambiguous).toBe(true)
    expect(evaluation.decision.secondNearestCandidateDistanceMeters).toBeDefined()
  })

  it('rejects poor-accuracy readings with a reason', () => {
    const road = segment('road-1', [40.7, -74.01], [40.7, -73.99])
    const evaluation = evaluateTripPoint(point(40.7, -74.005, 0, 80), createRoadIndex([road]))
    expect(evaluation.match).toBeUndefined()
    expect(evaluation.decision.rejectionReason).toBe('poor-accuracy-over-50m')
    expect(shouldAcceptTripPoint(undefined, point(40.7, -74.005, 0, 80))).toBe(false)
  })

  it('rejects a short impossible GPS jump', () => {
    const evaluation = evaluateTripPoint(point(40.705, -74.005, 5), null, { previousPoint: point(40.7, -74.005, 0) })
    expect(evaluation.decision.rejectionReason).toBe('impossible-jump-over-55mps')
  })

  it('collapses repeated stationary readings without losing the decision', () => {
    const evaluation = evaluateTripPoint(point(40.700005, -74.005, 5), null, { previousPoint: point(40.7, -74.005, 0) })
    expect(shouldAcceptTripPoint(undefined, point(40.7, -74.005, 0))).toBe(true)
    expect(evaluation.decision.status).toBe('stationary')
    expect(evaluation.decision.acceptedPoint).toBe(false)
  })

  it('accepts recovery after a rejected poor interval', () => {
    const road = segment('road-1', [40.7, -74.01], [40.7, -73.99])
    const index = createRoadIndex([road])
    const previous = point(40.7, -74.005, 0)
    const bad = evaluateTripPoint(point(40.70001, -74.004, 5, 90), index, { previousPoint: previous, previousSegment: road })
    const recovered = evaluateTripPoint(point(40.70001, -74.003, 15, 5), index, { previousPoint: previous, previousSegment: road })
    expect(bad.decision.acceptedPoint).toBe(false)
    expect(recovered.match?.segment.segmentId).toBe('road-1')
  })

  it('preserves continuity across connected OSM segments', () => {
    const first = segment('road-1', [40.7, -74.01], [40.7, -74])
    const next = segment('road-2', [40.7, -74], [40.71, -74])
    const evaluation = evaluateTripPoint(point(40.7007, -74, 5), createRoadIndex([first, next]), { previousPoint: point(40.7, -74.001, 0), previousSegment: first })
    expect(evaluation.match?.segment.segmentId).toBe('road-2')
    expect(evaluation.decision.continuityAffected).toBe(false)
  })

  it('rejects a disconnected candidate instead of teleporting the match', () => {
    const first = segment('road-1', [40.7, -74.01], [40.7, -74])
    const farRoad = segment('road-2', [40.7, -73.999], [40.71, -73.999])
    const evaluation = evaluateTripPoint(point(40.7007, -73.999, 5), createRoadIndex([first, farRoad]), { previousPoint: point(40.7, -74.001, 0), previousSegment: first })
    expect(evaluation.match).toBeUndefined()
    expect(evaluation.decision.matchRejectionReason).toBe('disconnected-from-previous-segment')
  })

  it('reports the no-road-data state separately from poor GPS quality', () => {
    const evaluation = evaluateTripPoint(point(40.7, -74.005, 0), null)
    expect(evaluation.decision.acceptedPoint).toBe(true)
    expect(evaluation.decision.matchRejectionReason).toBe('no-road-data-loaded')
  })

  it('uses distinct cache cells and a radius that crosses a cell boundary safely', () => {
    const west = { lat: 40.6999, lng: -74.0001 }
    const east = { lat: 40.7001, lng: -73.9999 }
    expect(roadCacheKey(west)).not.toBe(roadCacheKey(east))
    const bbox = roadBbox(west)
    expect(bbox.minLat).toBeLessThan(west.lat)
    expect(bbox.maxLng).toBeGreaterThan(west.lng)
  })
})
