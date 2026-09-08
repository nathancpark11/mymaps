import { describe, expect, it } from 'vitest'
import { localStore } from '../src/lib/storage'

describe('local-first persistence contracts', () => {
  it('round-trips trip diagnostics, permanent discoveries, and road cache records', async () => {
    const suffix = Date.now().toString()
    const tripId = `storage-test-trip-${suffix}`
    const cacheKey = `storage-test-cache-${suffix}`
    await localStore.saveTrip({
      id: tripId,
      startedAt: '2026-01-01T00:00:00.000Z',
      points: [{ lat: 40.7, lng: -74, recordedAt: '2026-01-01T00:00:00.000Z', accuracyMeters: 5 }],
      distanceMeters: 0,
      observations: [{ observationId: 'observation-1', lat: 40.7, lng: -74, recordedAt: '2026-01-01T00:00:00.000Z', accuracyMeters: 5 }],
      decisions: [{ observationId: 'observation-1', status: 'accepted', acceptedPoint: true, candidateCount: 1, candidateSegmentIds: ['road-1'], ambiguous: false, continuityAffected: false }],
    })
    await localStore.saveDiscovery({ segmentId: 'road-1', firstDiscoveredAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z', tripId })
    await localStore.saveRoadData({ cacheKey, center: { lat: 40.7, lng: -74 }, fetchedAt: new Date().toISOString(), segments: [] })

    const snapshot = await localStore.snapshot()
    const trip = snapshot.trips.find((item) => item.id === tripId)
    const discovery = snapshot.discoveries.find((item) => item.segmentId === 'road-1')
    const cache = await localStore.getRoadData(cacheKey)
    expect(trip?.decisions?.[0].candidateSegmentIds).toEqual(['road-1'])
    expect(discovery?.tripId).toBe(tripId)
    expect(cache?.cacheKey).toBe(cacheKey)
  })
})
