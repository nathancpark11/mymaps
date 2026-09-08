import { describe, expect, it } from 'vitest'
import type { RoadSegment, TripPoint } from '../src/types'
import { createRoadIndex, matchPointToRoad, shouldAcceptTripPoint } from '../src/lib/roadMatching'

const center = { lat: 40.7, lng: -74 }

function segment(segmentId: string, a: [number, number], b: [number, number], highway = 'residential'): RoadSegment {
  return {
    segmentId,
    osmWayId: Number(segmentId.replace(/\D/g, '')) || 1,
    geometry: [{ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }],
    highway,
    sectorId: 'sector:2:2',
    isMajor: false,
  }
}

function point(lat: number, lng: number, seconds: number, accuracyMeters = 5): TripPoint {
  return { lat, lng, accuracyMeters, recordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString() }
}

describe('GPS road matching', () => {
  it('matches points directly following a road', () => {
    const road = segment('road-1', [40.7, -74.01], [40.7, -73.99])
    const index = createRoadIndex([road])
    expect(matchPointToRoad(point(40.70001, -74.005, 0), index)?.segment.segmentId).toBe('road-1')
    expect(matchPointToRoad(point(40.70001, -74.002, 5), index, { previousPoint: point(40.70001, -74.005, 0), previousSegment: road })?.segment.segmentId).toBe('road-1')
  })

  it('does not choose an adjacent parallel road when the traveled road is clear', () => {
    const traveled = segment('road-1', [40.7, -74.01], [40.7, -73.99])
    const parallel = segment('road-2', [40.70011, -74.01], [40.70011, -73.99])
    const match = matchPointToRoad(point(40.70001, -74.005, 0), createRoadIndex([traveled, parallel]))
    expect(match?.segment.segmentId).toBe('road-1')
  })

  it('allows a connected turn at an intersection', () => {
    const eastWest = segment('road-1', [40.7, -74.01], [40.7, -74])
    const northSouth = segment('road-2', [40.7, -74], [40.71, -74])
    const index = createRoadIndex([eastWest, northSouth])
    const previousPoint = point(40.7, -74.001, 0)
    const match = matchPointToRoad(point(40.701, -74, 5), index, { previousPoint, previousSegment: eastWest })
    expect(match?.segment.segmentId).toBe('road-2')
  })

  it('rejects poor-accuracy readings', () => {
    const road = segment('road-1', [40.7, -74.01], [40.7, -73.99])
    expect(matchPointToRoad(point(40.7, -74.005, 0, 80), createRoadIndex([road]))).toBeNull()
    expect(shouldAcceptTripPoint(undefined, point(40.7, -74.005, 0, 80))).toBe(false)
  })

  it('rejects a short impossible GPS jump', () => {
    const previous = point(40.7, -74.005, 0)
    const jump = point(40.705, -74.005, 5)
    expect(shouldAcceptTripPoint(previous, jump)).toBe(false)
  })

  it('collapses repeated stationary readings', () => {
    const first = point(40.7, -74.005, 0)
    const repeated = point(40.700005, -74.005, 5)
    expect(shouldAcceptTripPoint(undefined, first)).toBe(true)
    expect(shouldAcceptTripPoint(first, repeated)).toBe(false)
  })
})
