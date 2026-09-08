import { useEffect, useMemo, useRef, useState } from 'react'
import { LngLatBounds, type Map as MapLibreMap } from 'maplibre-gl'
import {
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Footprints,
  Globe2,
  LocateFixed,
  LoaderCircle,
  MapPinned,
  Navigation,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { MapCanvas } from './components/MapCanvas'
import { bearingBetween, compassDirection, distanceBetween, FALLBACK_LOCATION, formatDistance, makeId, sectorIdForCoordinate, smoothBearing, watchCurrentLocation } from './lib/geo'
import { searchOutsideMap as searchExternalPlaces, type ExternalSearchResult } from './lib/externalSearch'
import { loadRoadData, mergeRoadSegments, roadCacheKey } from './lib/roadData'
import { createRoadIndex, decisionWithObservationId, evaluateTripPoint, MATCHING_THRESHOLDS, type RoadIndex } from './lib/roadMatching'
import { localStore } from './lib/storage'
import type { Coordinates, DiscoveredSegment, GpsObservation, MatchDecision, RoadSegment, Trip, TripPoint, Waypoint, WaypointCategory } from './types'
import { CATEGORY_EMOJI, WAYPOINT_CATEGORIES } from './types'

type LocationMode = 'loading' | 'live' | 'fallback'
type RoutingMode = 'Normal' | '+5 min' | '+10 min' | 'Adventurous'

const ROUTING_MODES: RoutingMode[] = ['Normal', '+5 min', '+10 min', 'Adventurous']

function formatElapsed(seconds: number) {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return hours ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}` : `${minutes}:${remainder.toString().padStart(2, '0')}`
}

type ActiveTrip = {
  id: string
  startedAt: string
  points: TripPoint[]
  observations: GpsObservation[]
  decisions: MatchDecision[]
  distanceMeters: number
  matchedSegmentIds: string[]
  lastMatchedSegmentId?: string
}

function App() {
  const [location, setLocation] = useState<Coordinates>(FALLBACK_LOCATION)
  const [locationMode, setLocationMode] = useState<LocationMode>('loading')
  const [waypoints, setWaypoints] = useState<Waypoint[]>([])
  const [search, setSearch] = useState('')
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [isPanelExpanded, setIsPanelExpanded] = useState(false)
  const [routingMode, setRoutingMode] = useState<RoutingMode>('Normal')
  const [toast, setToast] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<number | null>(null)
  const [externalSearchActive, setExternalSearchActive] = useState(false)
  const [externalSearchLoading, setExternalSearchLoading] = useState(false)
  const [externalSearchError, setExternalSearchError] = useState<string | null>(null)
  const [externalResults, setExternalResults] = useState<ExternalSearchResult[]>([])
  const [externalLocation, setExternalLocation] = useState<ExternalSearchResult | null>(null)
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>([])
  const [roadDataStatus, setRoadDataStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [discoveredSegmentIds, setDiscoveredSegmentIds] = useState<string[]>([])
  const [completedTrips, setCompletedTrips] = useState<Trip[]>([])
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null)
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(null)
  const [isFollowing, setIsFollowing] = useState(false)
  const [followRequestToken, setFollowRequestToken] = useState(0)
  const [tripHeading, setTripHeading] = useState<number | null>(null)
  const [tripSpeedMetersPerSecond, setTripSpeedMetersPerSecond] = useState<number | null>(null)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [diagnosticEnabled, setDiagnosticEnabled] = useState(false)
  const [selectedObservationIndex, setSelectedObservationIndex] = useState(0)
  const mapRef = useRef<MapLibreMap | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const externalAbortRef = useRef<AbortController | null>(null)
  const activeTripRef = useRef<ActiveTrip | null>(null)
  const roadIndexRef = useRef<RoadIndex | null>(null)
  const roadSegmentsRef = useRef<RoadSegment[]>([])
  const discoveredIdsRef = useRef(new Set<string>())
  activeTripRef.current = activeTrip
  roadIndexRef.current = createRoadIndex(roadSegments)
  roadSegmentsRef.current = roadSegments
  discoveredIdsRef.current = new Set(discoveredSegmentIds)

  const requestLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocationMode('fallback')
      setLocationError(0)
      return
    }

    setLocationMode('loading')
    setLocationError(null)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = { lat: position.coords.latitude, lng: position.coords.longitude }
        setLocation(nextLocation)
        setLocationMode('live')
        setLocationError(null)
        try { window.localStorage.setItem('my-maps:last-location', JSON.stringify(nextLocation)) } catch { /* local storage is optional */ }
      },
      (error) => {
        setLocationMode('fallback')
        setLocationError(error.code)
        setToast(error.code === 1 ? 'Location access is blocked for this site' : 'Could not get a GPS fix yet')
      },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 20_000 },
    )
  }

  useEffect(() => {
    localStore.snapshot().then((snapshot) => {
      setWaypoints(snapshot.waypoints)
      setCompletedTrips(snapshot.trips.sort((a, b) => b.startedAt.localeCompare(a.startedAt)))
      const ids = snapshot.discoveries.map((discovery) => discovery.segmentId)
      setDiscoveredSegmentIds(ids)
      discoveredIdsRef.current = new Set(ids)
    }).catch(() => {
      setWaypoints([])
      setCompletedTrips([])
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    requestLocation()
  }, [])

  useEffect(() => {
    let cancelled = false
    setRoadDataStatus('loading')
    loadRoadData(location).then((roadData) => {
      if (cancelled) return
      setRoadSegments((current) => mergeRoadSegments(current, roadData.segments))
      setRoadDataStatus('ready')
    }).catch(() => {
      if (!cancelled) {
        setRoadSegments([])
        setRoadDataStatus('error')
      }
    })
    return () => { cancelled = true }
    // Road data is loaded once per small cached area, not on every GPS update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roadCacheKey(location)])

  useEffect(() => {
    if (!isComposerOpen) return
    const watchId = watchCurrentLocation(
      (nextLocation) => {
        setLocation(nextLocation)
        setLocationMode('live')
        setLocationError(null)
        try { window.localStorage.setItem('my-maps:last-location', JSON.stringify(nextLocation)) } catch { /* local storage is optional */ }
      },
      (error) => {
        setLocationMode((current) => (current === 'live' ? current : 'fallback'))
        setLocationError(error.code)
      },
    )
    return () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
    }
  }, [isComposerOpen])

  const appendTripPoint = (coordinates: Coordinates, accuracyMeters?: number, speedMetersPerSecond?: number, headingDegrees?: number) => {
    const draft = activeTripRef.current
    if (!draft) return
    const point: TripPoint = { ...coordinates, accuracyMeters, recordedAt: new Date().toISOString() }
    const previousPoint = draft.points[draft.points.length - 1]
    const observation: GpsObservation = { ...point, observationId: makeId('observation') }
    const evaluation = evaluateTripPoint(point, roadIndexRef.current, {
      previousPoint,
      previousSegment: draft.lastMatchedSegmentId ? roadSegmentsRef.current.find((segment) => segment.segmentId === draft.lastMatchedSegmentId) : undefined,
    })
    const decision = decisionWithObservationId(observation.observationId, evaluation.decision)
    const match = evaluation.match
    const browserSpeed = Number.isFinite(speedMetersPerSecond) && speedMetersPerSecond! >= 0 && speedMetersPerSecond! <= MATCHING_THRESHOLDS.maxSpeedMetersPerSecond
      ? speedMetersPerSecond!
      : null
    const derivedSpeed = evaluation.decision.movementSpeedMetersPerSecond != null && evaluation.decision.movementSpeedMetersPerSecond <= MATCHING_THRESHOLDS.maxSpeedMetersPerSecond
      ? evaluation.decision.movementSpeedMetersPerSecond
      : null
    setTripSpeedMetersPerSecond(browserSpeed ?? derivedSpeed)
    if (evaluation.decision.acceptedPoint) {
      const effectiveSpeed = browserSpeed ?? derivedSpeed ?? 0
      const usableHeading = Number.isFinite(headingDegrees) && headingDegrees! >= 0 && headingDegrees! <= 360
        ? headingDegrees!
        : previousPoint && (evaluation.decision.movementDistanceMeters ?? 0) >= 4 ? bearingBetween(previousPoint, point) : null
      if (usableHeading != null && effectiveSpeed >= 1.5) setTripHeading((current) => smoothBearing(current, usableHeading))
    }
    const observations = [...draft.observations, observation]
    const decisions = [...draft.decisions, decision]
    setSelectedObservationIndex(decisions.length - 1)

    if (!evaluation.decision.acceptedPoint) {
      const rejectedTrip = { ...draft, observations, decisions }
      activeTripRef.current = rejectedTrip
      setActiveTrip(rejectedTrip)
      setLocation(coordinates)
      setLocationMode('live')
      return
    }

    const matchedSegmentIds = match && !draft.matchedSegmentIds.includes(match.segment.segmentId)
      ? [...draft.matchedSegmentIds, match.segment.segmentId]
      : draft.matchedSegmentIds
    if (match && !discoveredIdsRef.current.has(match.segment.segmentId)) {
      const discovery: DiscoveredSegment = {
        segmentId: match.segment.segmentId,
        firstDiscoveredAt: point.recordedAt,
        lastSeenAt: point.recordedAt,
        tripId: draft.id,
      }
      discoveredIdsRef.current.add(match.segment.segmentId)
      setDiscoveredSegmentIds((current) => current.includes(match.segment.segmentId) ? current : [...current, match.segment.segmentId])
      localStore.saveDiscovery(discovery).catch(() => setToast('Road found, but discovery could not be saved'))
    }

    const updatedTrip: ActiveTrip = {
      ...draft,
      points: [...draft.points, point],
      observations,
      decisions,
      distanceMeters: draft.distanceMeters + (previousPoint ? distanceBetween(previousPoint, point) : 0),
      matchedSegmentIds,
      lastMatchedSegmentId: match?.segment.segmentId ?? draft.lastMatchedSegmentId,
    }
    activeTripRef.current = updatedTrip
    setActiveTrip(updatedTrip)
    setLocation(coordinates)
    setLocationMode('live')
  }

  useEffect(() => {
    if (!activeTrip?.id) return
    const watchId = watchCurrentLocation(
      (nextLocation, accuracyMeters, speedMetersPerSecond, headingDegrees) => appendTripPoint(nextLocation, accuracyMeters, speedMetersPerSecond, headingDegrees),
      () => setToast('Trip recording lost the location signal'),
    )
    return () => {
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId)
    }
    // Keep one foreground watcher for the active trip; point updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTrip?.id])

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  useEffect(() => {
    if (!activeTrip) return
    setClockNow(Date.now())
    const interval = window.setInterval(() => setClockNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [activeTrip?.id])

  const filteredWaypoints = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    if (!normalizedSearch) return waypoints
    return waypoints.filter((waypoint) => `${waypoint.name} ${waypoint.category}`.toLowerCase().includes(normalizedSearch))
  }, [search, waypoints])

  const sectorStats = useMemo(() => {
    const stats: Record<string, { totalSegments: number; discoveredSegments: number; percentage: number }> = {}
    for (const segment of roadSegments) {
      const current = stats[segment.sectorId] ?? { totalSegments: 0, discoveredSegments: 0, percentage: 0 }
      current.totalSegments += 1
      if (discoveredSegmentIds.includes(segment.segmentId)) current.discoveredSegments += 1
      current.percentage = current.totalSegments ? Math.round((current.discoveredSegments / current.totalSegments) * 100) : 0
      stats[segment.sectorId] = current
    }
    return stats
  }, [roadSegments, discoveredSegmentIds])

  const currentSectorId = sectorIdForCoordinate(location, location)
  const currentSectorProgress = sectorStats[currentSectorId]?.percentage ?? 0
  const selectedTrip = completedTrips.find((trip) => trip.id === selectedTripId)
  const tripElapsedSeconds = activeTrip ? Math.max(0, Math.floor((clockNow - Date.parse(activeTrip.startedAt)) / 1_000)) : 0
  const tripSpeedMph = tripSpeedMetersPerSecond != null ? tripSpeedMetersPerSecond * 2.236936 : null
  const diagnosticTrip = activeTrip ?? selectedTrip
  const diagnosticObservations = diagnosticTrip?.observations ?? diagnosticTrip?.points.map((point, index) => ({ ...point, observationId: `legacy-${index}` })) ?? []
  const diagnosticDecisions = diagnosticTrip?.decisions ?? []
  const diagnosticIndex = diagnosticTrip
    ? activeTrip ? Math.max(0, diagnosticObservations.length - 1) : Math.min(selectedObservationIndex, Math.max(0, diagnosticObservations.length - 1))
    : 0
  const focusedObservation = diagnosticObservations[diagnosticIndex]
  const focusedDecision = diagnosticDecisions[diagnosticIndex]
  const diagnosticCandidateSegments = focusedDecision
    ? focusedDecision.candidateSegmentIds.map((id) => roadSegments.find((segment) => segment.segmentId === id)).filter((segment): segment is RoadSegment => Boolean(segment))
    : []
  const diagnosticMatchedSegment = focusedDecision?.matchedSegmentId
    ? roadSegments.find((segment) => segment.segmentId === focusedDecision.matchedSegmentId) ?? null
    : null
  const diagnosticRejectedPoints = diagnosticDecisions.length
    ? diagnosticObservations.filter((_, index) => diagnosticDecisions[index]?.status !== 'accepted')
    : []

  const exportTripDiagnostic = (trip: Trip) => {
    const payload = {
      exportedAt: new Date().toISOString(),
      matcherThresholds: MATCHING_THRESHOLDS,
      trip,
      acceptedPoints: trip.points,
      observations: trip.observations ?? [],
      decisions: trip.decisions ?? [],
      matchedSegmentIds: [...new Set((trip.decisions ?? []).map((decision) => decision.matchedSegmentId).filter(Boolean))],
      roadSegments: roadSegments.filter((segment) => (trip.decisions ?? []).some((decision) => decision.candidateSegmentIds.includes(segment.segmentId))),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `my-maps-trip-${trip.startedAt.slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const focusWaypoint = (waypoint: Waypoint) => {
    setSearch(waypoint.name)
    setExternalSearchActive(false)
    setExternalLocation(null)
    mapRef.current?.flyTo({ center: [waypoint.location.lng, waypoint.location.lat], zoom: 15.5, duration: 800, essential: true })
    setToast(`Centered on ${waypoint.name}`)
  }

  const handleSearchChange = (value: string) => {
    setSearch(value)
    setExternalSearchActive(false)
    setExternalSearchError(null)
    setExternalResults([])
    setExternalLocation(null)
    externalAbortRef.current?.abort()
  }

  const saveWaypoint = (name: string, category: WaypointCategory) => {
    const waypoint: Waypoint = {
      id: makeId('waypoint'),
      name: name.trim(),
      category,
      location,
      createdAt: new Date().toISOString(),
    }
    localStore.saveWaypoint(waypoint).then(() => {
      setWaypoints((current) => [waypoint, ...current])
      setIsComposerOpen(false)
      setToast(`${waypoint.name} is on your map`)
    }).catch(() => setToast('Could not save that place locally'))
  }

  const startTrip = () => {
    if (activeTripRef.current) return
    const draft: ActiveTrip = {
      id: makeId('trip'),
      startedAt: new Date().toISOString(),
      points: [],
      observations: [],
      decisions: [],
      distanceMeters: 0,
      matchedSegmentIds: [],
    }
    activeTripRef.current = draft
    setActiveTrip(draft)
    setIsFollowing(true)
    setTripHeading(null)
    setTripSpeedMetersPerSecond(null)
    setFollowRequestToken((current) => current + 1)
    setSelectedTripId(null)
    if (locationMode !== 'live') requestLocation()
    setToast(roadDataStatus === 'ready' ? 'Trip recording started' : 'Trip started — local roads are still loading')
  }

  const endTrip = async () => {
    const draft = activeTripRef.current
    if (!draft) return
    if (!window.confirm('End this trip and save it to your device?')) return
    const trip: Trip = {
      id: draft.id,
      startedAt: draft.startedAt,
      endedAt: new Date().toISOString(),
      points: draft.points,
      distanceMeters: draft.distanceMeters,
      observations: draft.observations,
      decisions: draft.decisions,
    }
    activeTripRef.current = null
    setActiveTrip(null)
    setIsFollowing(false)
    setTripHeading(null)
    setTripSpeedMetersPerSecond(null)
    try {
      await localStore.saveTrip(trip)
      setCompletedTrips((current) => [trip, ...current])
      setToast(trip.points.length > 1 ? `Trip saved · ${trip.points.length} points` : 'Trip saved with no usable GPS points')
    } catch {
      setToast('Trip ended, but could not be saved locally')
    }
  }

  const selectTrip = (trip: Trip) => {
    setSelectedTripId(trip.id)
    setSelectedObservationIndex(0)
    if (!mapRef.current || !trip.points.length) return
    if (trip.points.length === 1) {
      mapRef.current.flyTo({ center: [trip.points[0].lng, trip.points[0].lat], zoom: 15, duration: 800, essential: true })
      return
    }
    const bounds = new LngLatBounds()
    trip.points.forEach((point) => bounds.extend([point.lng, point.lat]))
    mapRef.current.fitBounds(bounds, { padding: { top: 100, bottom: 230, left: 30, right: 30 }, maxZoom: 16, duration: 900, essential: true })
  }

  const recenterMap = () => {
    if (locationMode !== 'live') {
      requestLocation()
      return
    }
    if (activeTrip) {
      setIsFollowing(true)
      setFollowRequestToken((current) => current + 1)
      setToast('Following your location')
      return
    }
    mapRef.current?.flyTo({ center: [location.lng, location.lat], zoom: 14.2, duration: 850, essential: true })
    setToast('Centered on your location')
  }

  const pauseFollow = () => {
    if (!activeTrip || !isFollowing) return
    setIsFollowing(false)
    setToast('Follow paused · tap Recenter to resume')
  }

  const locationHelp = locationError === 1
    ? 'Location access is blocked. Allow it for this site, then try again.'
    : locationError === 2
      ? 'Your device could not find a GPS fix. Try again somewhere with a clearer view of the sky.'
      : locationError === 3
        ? 'The location request timed out. Try again.'
    : 'Allow location access to move the map to where you are.'

  const searchOutsideMyMap = async () => {
    const query = search.trim()
    if (!query) {
      setToast('Type an address or place to search outside your map')
      searchRef.current?.focus()
      return
    }

    externalAbortRef.current?.abort()
    const controller = new AbortController()
    externalAbortRef.current = controller
    setExternalSearchActive(true)
    setExternalSearchLoading(true)
    setExternalSearchError(null)
    setExternalResults([])
    setExternalLocation(null)

    try {
      const results = await searchExternalPlaces(query, controller.signal)
      setExternalResults(results)
      if (!results.length) setToast(`No outside results for “${query}”`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setExternalSearchError('Outside search is temporarily unavailable. Try again in a moment.')
    } finally {
      if (!controller.signal.aborted) setExternalSearchLoading(false)
    }
  }

  const focusExternalResult = (result: ExternalSearchResult) => {
    setExternalLocation(result)
    mapRef.current?.flyTo({ center: [result.location.lng, result.location.lat], zoom: 15, duration: 900, essential: true })
    setToast(`Showing ${result.name}`)
  }

  const returnToPersonalSearch = () => {
    externalAbortRef.current?.abort()
    setExternalSearchActive(false)
    setExternalSearchLoading(false)
    setExternalSearchError(null)
    setExternalResults([])
    setExternalLocation(null)
  }

  return (
    <div className="app-shell">
      <section className="map-column">
        <section className={`map-stage ${isPanelExpanded ? 'map-stage--panel-expanded' : ''}`} aria-label="Exploration map">
          <MapCanvas
            location={location}
            waypoints={waypoints}
            roadSegments={roadSegments}
            discoveredSegmentIds={discoveredSegmentIds}
            activeTrace={activeTrip?.points ?? []}
            historicalTrace={selectedTrip?.points ?? []}
            sectorStats={sectorStats}
            diagnosticEnabled={diagnosticEnabled}
            diagnosticRawPoints={diagnosticObservations}
            diagnosticAcceptedPoints={diagnosticTrip?.points ?? []}
            diagnosticRejectedPoints={diagnosticRejectedPoints}
            diagnosticCandidateSegments={diagnosticCandidateSegments}
            diagnosticMatchedSegment={diagnosticMatchedSegment}
            followMode={Boolean(activeTrip)}
            followActive={Boolean(activeTrip && isFollowing)}
            followBearing={tripHeading ?? 0}
            followRequestToken={followRequestToken}
            locationBearing={tripHeading}
            onFollowInterrupted={pauseFollow}
            externalLocation={externalLocation ? { location: externalLocation.location, label: externalLocation.name } : null}
            isComposingWaypoint={isComposerOpen}
            onMapReady={(map) => { mapRef.current = map }}
          />
          <div className="map-wash" aria-hidden="true" />
          {activeTrip && <div className="driving-overlay" aria-label="Driving trip status">
            <div className="driving-overlay-topline"><span className="driving-mode-dot" /> <strong>DRIVING</strong><span>{isFollowing ? 'FOLLOWING' : 'FOLLOW PAUSED'}</span></div>
            <div className="driving-metrics">
              <div><small>HEADING</small><strong>{compassDirection(tripHeading)} <em>{tripHeading == null ? '' : `${Math.round(tripHeading)}°`}</em></strong></div>
              <div><small>SPEED</small><strong>{tripSpeedMph == null ? '—' : `${Math.round(tripSpeedMph)} mph`}</strong></div>
              <div><small>TRIP</small><strong>{formatDistance(activeTrip.distanceMeters / 1_609.344)}</strong></div>
              <div><small>TIME</small><strong>{formatElapsed(tripElapsedSeconds)}</strong></div>
            </div>
          </div>}
          {activeTrip && !isFollowing && <button className="follow-recenter-button" onClick={recenterMap}><LocateFixed size={15} /> Recenter &amp; follow</button>}
          <div className="map-toolbar">
            <div className="search-control">
              <label className="search-box">
                <Search size={18} strokeWidth={2.1} />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && filteredWaypoints[0]) focusWaypoint(filteredWaypoints[0])
                    if (event.key === 'Enter' && !filteredWaypoints[0] && search.trim()) searchOutsideMyMap()
                  }}
                  placeholder="Search your map"
                  aria-label="Search your personal map"
                />
                <kbd>⌘ K</kbd>
              </label>
              {search.trim() && <div className="search-results" role="listbox" aria-label={externalSearchActive ? 'Outside map results' : 'Personal map results'}>
                {externalSearchActive ? <>
                  <div className="search-mode-header"><span><Globe2 size={13} /> OUTSIDE MY MAP</span><button onClick={returnToPersonalSearch}>Personal map</button></div>
                  {externalSearchLoading && <div className="search-loading"><LoaderCircle size={17} /><span>Looking beyond your map…</span></div>}
                  {externalSearchError && <div className="search-error"><strong>Search unavailable</strong><span>{externalSearchError}</span><button onClick={searchOutsideMyMap}>Try again</button></div>}
                  {!externalSearchLoading && !externalSearchError && externalResults.map((result) => <button key={result.id} className="search-result" onClick={() => focusExternalResult(result)} role="option">
                    <span className="search-result-icon search-result-icon--external"><Globe2 size={14} /></span>
                    <span><strong>{result.name}</strong><small>{result.detail}</small></span>
                    <ChevronRight size={15} />
                  </button>)}
                  {!externalSearchLoading && !externalSearchError && !externalResults.length && <div className="search-empty"><strong>No outside results</strong><span>Try an address, street, or place name.</span></div>}
                  <div className="external-attribution">Search by <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">Nominatim</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div>
                </> : <>
                  {filteredWaypoints.slice(0, 4).map((waypoint) => <button key={waypoint.id} className="search-result" onClick={() => focusWaypoint(waypoint)} role="option">
                    <span className="search-result-icon">{CATEGORY_EMOJI[waypoint.category]}</span>
                    <span><strong>{waypoint.name}</strong><small>{waypoint.category}</small></span>
                    <ChevronRight size={15} />
                  </button>)}
                  {!filteredWaypoints.length && <div className="search-empty"><strong>Not in your map yet</strong><span>Try outside search below.</span></div>}
                  <button className="search-outside" onClick={searchOutsideMyMap}><Search size={14} /> Search Outside My Map</button>
                </>}
              </div>}
            </div>
            <div className="toolbar-row">
              <button className="icon-button" onClick={recenterMap} aria-label="Center map on your location" title="Center map">
                <LocateFixed size={18} />
              </button>
            </div>
          </div>

          <div className="map-caption">
            <div className="map-caption-icon"><Compass size={17} /></div>
            <div>
              <p>{locationMode === 'live' ? 'You are here' : 'Starting area'}</p>
              <span>{roadDataStatus === 'loading' ? 'Loading local roads' : locationMode === 'fallback' ? 'Location needed' : `${currentSectorProgress}% explored`}</span>
            </div>
          </div>

          {locationMode !== 'live' && <div className="location-prompt" role="status">
            <div className="location-prompt-icon"><LocateFixed size={17} /></div>
            <div className="location-prompt-copy"><strong>{locationMode === 'loading' ? 'Finding your location…' : 'Map is using a starting area'}</strong><span>{locationMode === 'loading' ? 'Your browser may ask for permission. This can take a few seconds.' : locationHelp}</span></div>
            <button onClick={requestLocation} disabled={locationMode === 'loading'}>{locationMode === 'loading' ? 'Waiting…' : 'Use my location'}</button>
          </div>}

          <button className={`trip-control ${activeTrip ? 'is-recording' : ''}`} onClick={activeTrip ? endTrip : startTrip}>
            <span className="trip-control-dot" />
            {activeTrip ? `End Trip · ${activeTrip.points.length} pts` : 'Start Trip'}
          </button>

          <button className="add-waypoint-button" onClick={() => setIsComposerOpen(true)} aria-label="Add a waypoint">
            <Plus size={25} strokeWidth={2.6} />
          </button>
          <div className="map-legend"><span className="legend-line legend-line--known" /> <span>your explored roads</span><span className="legend-line legend-line--quiet" /> <span>still waiting</span></div>
        </section>
      </section>

      <aside className={`exploration-panel ${isPanelExpanded ? 'is-expanded' : ''}`}>
        <button className="panel-handle" onClick={() => setIsPanelExpanded((current) => !current)} aria-expanded={isPanelExpanded} aria-label={isPanelExpanded ? 'Collapse map details' : 'Open map details'}>
          <span className="panel-handle-bar" />
        </button>
          <div className="panel-peek">
          <div><p className="eyebrow">YOUR AREA</p><strong>{currentSectorProgress}% explored</strong><span>{activeTrip ? 'Trip recording active' : waypoints.length ? `${waypoints.length} saved ${waypoints.length === 1 ? 'place' : 'places'}` : 'No saved places yet'}</span></div>
          <button onClick={() => setIsPanelExpanded(true)} aria-label="Open map details"><ChevronRight size={18} /></button>
        </div>
        <div className="panel-scroll">
          <div className="panel-intro">
            <div>
              <p className="eyebrow"><Sparkles size={13} /> YOUR MAP</p>
              <h1>Explore nearby.</h1>
            </div>
            <button className="round-add" onClick={() => setIsComposerOpen(true)} aria-label="Add a waypoint"><Plus size={20} /></button>
          </div>

          <div className="sector-card">
            <div className="sector-copy">
              <div className="card-kicker">THIS SECTOR</div>
              <strong>{currentSectorProgress}% explored</strong>
              <p>{roadDataStatus === 'ready' ? `${sectorStats[currentSectorId]?.discoveredSegments ?? 0} of ${sectorStats[currentSectorId]?.totalSegments ?? 0} local road segments discovered.` : 'Loading local road geometry…'}</p>
              <button className="text-button" onClick={() => setToast('Sector progress is calculated from local road data')}>How this works <ChevronRight size={14} /></button>
            </div>
            <div className="progress-orb" aria-label={`Sector exploration ${currentSectorProgress} percent`} style={{ '--progress': `${currentSectorProgress}%` } as React.CSSProperties}>
              <span>{currentSectorProgress}%</span>
              <small>explored</small>
            </div>
          </div>

          <div className="section-heading">
            <div><p className="eyebrow">PERSONAL PLACES</p><h2>{waypoints.length ? `${waypoints.length} saved ${waypoints.length === 1 ? 'place' : 'places'}` : 'Pin your places'}</h2></div>
            <button className="subtle-button" onClick={() => setIsComposerOpen(true)}><Plus size={15} /> Add</button>
          </div>
          <div className="personal-places">
            {search.trim() && filteredWaypoints.length === 0 ? (
              <div className="empty-search">
                <div className="empty-search-icon"><Search size={18} /></div>
                <div><strong>Nothing in your map yet</strong><p>Keep it personal, or look beyond your map.</p></div>
              </div>
            ) : filteredWaypoints.length ? (
              filteredWaypoints.slice(0, 4).map((waypoint) => (
                <button key={waypoint.id} className="place-row" onClick={() => focusWaypoint(waypoint)}>
                  <span className="place-icon">{CATEGORY_EMOJI[waypoint.category]}</span>
                  <span className="place-details"><strong>{waypoint.name}</strong><small>{waypoint.category}</small></span>
                  <ChevronRight size={16} className="place-arrow" />
                </button>
              ))
            ) : (
              <button className="first-place-row" onClick={() => setIsComposerOpen(true)}>
                <span className="first-place-icon"><MapPinned size={19} /></span>
                <span><strong>Save somewhere you know</strong><small>Your first waypoint starts the collection.</small></span>
                <ChevronRight size={17} />
              </button>
            )}
            <button className="outside-search-button" onClick={searchOutsideMyMap}><Search size={16} /> Search Outside My Map <span>↗</span></button>
          </div>

          <div className="section-heading">
            <div><p className="eyebrow">TRIP HISTORY</p><h2>{completedTrips.length ? `${completedTrips.length} saved ${completedTrips.length === 1 ? 'drive' : 'drives'}` : 'No saved drives yet'}</h2></div>
            {activeTrip && <span className="recording-label"><span className="recording-dot" /> recording</span>}
          </div>
          <div className="trip-history">
            {completedTrips.length ? completedTrips.slice(0, 5).map((trip) => <button key={trip.id} className={`trip-row ${selectedTripId === trip.id ? 'is-selected' : ''}`} onClick={() => selectTrip(trip)}>
              <span className="trip-row-icon"><Footprints size={15} /></span>
              <span><strong>{new Date(trip.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</strong><small>{new Date(trip.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {trip.points.length} points</small></span>
              <ChevronRight size={15} />
            </button>) : <div className="trip-empty"><Footprints size={16} /><span>Start a foreground trip to build your history.</span></div>}
          </div>

          <div className="diagnostic-control-row">
            <button className={`diagnostic-toggle ${diagnosticEnabled ? 'is-on' : ''}`} onClick={() => setDiagnosticEnabled((current) => !current)} aria-pressed={diagnosticEnabled}>
              <span className="diagnostic-toggle-dot" /> Developer diagnostics {diagnosticEnabled ? 'on' : 'off'}
            </button>
            {selectedTrip && <button className="diagnostic-export" onClick={() => exportTripDiagnostic(selectedTrip)}>Export JSON</button>}
          </div>
          {diagnosticEnabled && <div className="diagnostic-panel">
            <div className="diagnostic-panel-header"><div><p className="eyebrow">LIVE GPS PIPELINE</p><strong>{activeTrip ? 'Current trip' : selectedTrip ? 'Selected trip' : 'No trip selected'}</strong></div><span className="diagnostic-live-dot" /></div>
            {diagnosticTrip && focusedObservation ? <>
              {!activeTrip && diagnosticObservations.length > 1 && <label className="diagnostic-history-control">Inspect sample
                <select value={diagnosticIndex} onChange={(event) => setSelectedObservationIndex(Number(event.target.value))}>
                  {diagnosticObservations.map((observation, index) => <option key={observation.observationId} value={index}>{index + 1} · {new Date(observation.recordedAt).toLocaleTimeString()}</option>)}
                </select>
              </label>}
              <div className="diagnostic-grid">
                <div><small>GPS</small><strong>{focusedObservation.lat.toFixed(5)}, {focusedObservation.lng.toFixed(5)}</strong></div>
                <div><small>ACCURACY</small><strong>{focusedObservation.accuracyMeters == null ? '—' : `${focusedObservation.accuracyMeters.toFixed(1)} m`}</strong></div>
                <div><small>MOVE / SPEED</small><strong>{focusedDecision?.movementDistanceMeters == null ? '—' : `${focusedDecision.movementDistanceMeters.toFixed(1)} m / ${(focusedDecision.movementSpeedMetersPerSecond ?? 0).toFixed(1)} m/s`}</strong></div>
                <div><small>STATUS</small><strong className={`diagnostic-status diagnostic-status--${focusedDecision?.status ?? 'unknown'}`}>{focusedDecision?.status ?? 'legacy'}</strong></div>
              </div>
              <div className="diagnostic-detail"><span>Decision</span><strong>{focusedDecision?.rejectionReason ?? focusedDecision?.matchRejectionReason ?? (focusedDecision?.matchedSegmentId ? 'matched and accepted' : 'accepted, no road match')}</strong></div>
              <div className="diagnostic-detail"><span>Road</span><strong>{focusedDecision?.matchedRoadName ?? focusedDecision?.matchedSegmentId ?? 'No matched segment'}</strong></div>
              <div className="diagnostic-detail"><span>Candidates</span><strong>{focusedDecision ? `${focusedDecision.candidateCount} · nearest ${focusedDecision.nearestCandidateDistanceMeters?.toFixed(1) ?? '—'} m · second ${focusedDecision.secondNearestCandidateDistanceMeters?.toFixed(1) ?? '—'} m` : 'Legacy trip has no decision record'}</strong></div>
              <div className="diagnostic-detail"><span>Continuity</span><strong>{focusedDecision?.continuityReason ?? (focusedDecision?.continuityAffected ? 'affected' : 'continuous')}</strong></div>
            </> : <p className="diagnostic-empty">Start a trip or select a saved trip to inspect GPS decisions.</p>}
          </div>}

          <div className="section-heading section-heading--route">
            <div><p className="eyebrow">GENTLE GUIDANCE</p><h2>Explore on your terms</h2></div>
            <Navigation size={18} className="heading-icon" />
          </div>
          <div className="route-preview">
            <div className="route-topline"><span><Footprints size={15} /> Ready when you are</span><span className="future-label">PREVIEW</span></div>
            <div className="route-stats">
              <div><small>DESTINATION</small><strong>—</strong></div>
              <div><small>DIRECTION</small><strong>—</strong></div>
              <div><small>DISTANCE</small><strong>—</strong></div>
            </div>
            <div className="route-divider" />
            <div className="mode-label"><span>Explore mode</span><span>favor new roads</span></div>
            <div className="routing-modes" role="group" aria-label="Exploration routing mode">
              {ROUTING_MODES.map((mode) => <button key={mode} className={routingMode === mode ? 'is-active' : ''} onClick={() => setRoutingMode(mode)}>{mode}</button>)}
            </div>
          </div>

          <div className="quiet-note"><Clock3 size={15} /><span><strong>Trips stay yours.</strong> Your drives and discoveries live on this device.</span></div>
          <p className="panel-footnote">My-Maps is an exploration layer, not a turn-by-turn replacement.</p>
        </div>
      </aside>

      {isComposerOpen && <WaypointComposer locationMode={locationMode} onClose={() => setIsComposerOpen(false)} onSave={saveWaypoint} />}
      {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
    </div>
  )
}

function WaypointComposer({ locationMode, onClose, onSave }: { locationMode: LocationMode; onClose: () => void; onSave: (name: string, category: WaypointCategory) => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<WaypointCategory>('Other')

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (name.trim()) onSave(name, category)
  }

  return (
    <div className="composer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="waypoint-composer" onSubmit={submit}>
        <div className="composer-grabber" />
        <div className="composer-header">
          <div><p className="eyebrow"><MapPinned size={13} /> NEW WAYPOINT</p><h2>Mark this moment</h2></div>
          <button type="button" className="close-button" onClick={onClose} aria-label="Close waypoint editor"><X size={20} /></button>
        </div>
        <div className="follow-banner"><span className="follow-ping" /><span><strong>{locationMode === 'live' ? 'Following your location' : 'Using the map starting point'}</strong><small>{locationMode === 'live' ? 'The pin will keep moving until you save.' : 'Location access will make this pin more precise.'}</small></span></div>
        <label className="field-label" htmlFor="waypoint-name">Name</label>
        <input id="waypoint-name" className="name-input" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. the good coffee spot" maxLength={48} />
        <div className="field-label">Category</div>
        <div className="category-grid">
          {WAYPOINT_CATEGORIES.map((item) => <button type="button" key={item} className={`category-option ${category === item ? 'is-selected' : ''}`} onClick={() => setCategory(item)}><span>{CATEGORY_EMOJI[item]}</span>{item}</button>)}
        </div>
        <button className="save-waypoint" type="submit" disabled={!name.trim()}><Check size={17} /> Save to my map</button>
      </form>
    </div>
  )
}

export default App
