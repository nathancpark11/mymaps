import { useEffect, useMemo, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Footprints,
  LocateFixed,
  Map as MapIcon,
  MapPinned,
  Navigation,
  Plus,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { MapCanvas } from './components/MapCanvas'
import { FALLBACK_LOCATION, makeId, watchCurrentLocation } from './lib/geo'
import { localStore } from './lib/storage'
import type { Coordinates, Waypoint, WaypointCategory } from './types'
import { CATEGORY_EMOJI, WAYPOINT_CATEGORIES } from './types'

type LocationMode = 'loading' | 'live' | 'fallback'
type RoutingMode = 'Normal' | '+5 min' | '+10 min' | 'Adventurous'

const ROUTING_MODES: RoutingMode[] = ['Normal', '+5 min', '+10 min', 'Adventurous']

function App() {
  const [location, setLocation] = useState<Coordinates>(FALLBACK_LOCATION)
  const [locationMode, setLocationMode] = useState<LocationMode>('loading')
  const [waypoints, setWaypoints] = useState<Waypoint[]>([])
  const [search, setSearch] = useState('')
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [routingMode, setRoutingMode] = useState<RoutingMode>('Normal')
  const [toast, setToast] = useState<string | null>(null)
  const [locationError, setLocationError] = useState<number | null>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

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
        window.localStorage.setItem('my-maps:last-location', JSON.stringify(nextLocation))
      },
      (error) => {
        setLocationMode('fallback')
        setLocationError(error.code)
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    )
  }

  useEffect(() => {
    localStore.listWaypoints().then(setWaypoints).catch(() => setWaypoints([]))
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
    if (!isComposerOpen) return
    const watchId = watchCurrentLocation(
      (nextLocation) => {
        setLocation(nextLocation)
        setLocationMode('live')
        setLocationError(null)
        window.localStorage.setItem('my-maps:last-location', JSON.stringify(nextLocation))
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

  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const filteredWaypoints = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    if (!normalizedSearch) return waypoints
    return waypoints.filter((waypoint) => `${waypoint.name} ${waypoint.category}`.toLowerCase().includes(normalizedSearch))
  }, [search, waypoints])

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

  const recenterMap = () => {
    if (locationMode !== 'live') {
      requestLocation()
      return
    }
    mapRef.current?.flyTo({ center: [location.lng, location.lat], zoom: 14.2, duration: 850, essential: true })
    setToast('Centered on your location')
  }

  const locationHelp = locationError === 1
    ? 'Location access is blocked. Allow it for this site, then try again.'
    : locationError === 2
      ? 'Your device could not find a GPS fix. Try again somewhere with a clearer view of the sky.'
      : locationError === 3
        ? 'The location request timed out. Try again.'
        : 'Allow location access to move the map to where you are.'

  const searchOutsideMyMap = () => {
    setToast(search.trim() ? `Outside search for “${search.trim()}” is coming later` : 'Outside search is coming later')
  }

  return (
    <div className="app-shell">
      <section className="map-column">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true"><MapIcon size={19} strokeWidth={2.4} /></div>
            <div>
              <p className="brand-name">my-maps</p>
              <p className="brand-tagline">learn your way around</p>
            </div>
          </div>
          <div className="location-status" title={locationMode === 'live' ? 'Using live device location' : 'Using the map starting area'}>
            <span className={`status-dot status-dot--${locationMode}`} />
            {locationMode === 'live' ? 'Live location' : locationMode === 'loading' ? 'Finding you…' : 'Starting area'}
          </div>
        </header>

        <section className="map-stage" aria-label="Exploration map">
          <MapCanvas
            location={location}
            waypoints={waypoints}
            isComposingWaypoint={isComposerOpen}
            onMapReady={(map) => { mapRef.current = map }}
          />
          <div className="map-wash" aria-hidden="true" />
          <div className="map-toolbar">
            <label className="search-box">
              <Search size={18} strokeWidth={2.1} />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search your map"
                aria-label="Search your personal map"
              />
              <kbd>⌘ K</kbd>
            </label>
            <div className="toolbar-row">
              <div className="map-chip"><span className="chip-swatch" /> Sectors on</div>
              <button className="icon-button" onClick={recenterMap} aria-label="Center map on your location" title="Center map">
                <LocateFixed size={18} />
              </button>
            </div>
          </div>

          <div className="map-caption">
            <div className="map-caption-icon"><Compass size={17} /></div>
            <div>
              <p>{locationMode === 'live' ? 'You are here' : 'A starting point for your map'}</p>
              <span>{locationMode === 'fallback' ? 'Allow location for a more personal view' : 'Drive it. Discover it.'}</span>
            </div>
          </div>

          {locationMode === 'fallback' && <div className="location-prompt" role="status">
            <div className="location-prompt-icon"><LocateFixed size={17} /></div>
            <div className="location-prompt-copy"><strong>Map is using a starting area</strong><span>{locationHelp}</span></div>
            <button onClick={requestLocation}>Use my location</button>
          </div>}

          <button className="add-waypoint-button" onClick={() => setIsComposerOpen(true)} aria-label="Add a waypoint">
            <Plus size={25} strokeWidth={2.6} />
          </button>
          <div className="map-legend"><span className="legend-line legend-line--known" /> <span>your explored roads</span><span className="legend-line legend-line--quiet" /> <span>still waiting</span></div>
        </section>
      </section>

      <aside className="exploration-panel">
        <div className="panel-handle" aria-hidden="true" />
        <div className="panel-scroll">
          <div className="panel-intro">
            <div>
              <p className="eyebrow"><Sparkles size={13} /> YOUR MAP</p>
              <h1>Take the long way<br className="desktop-break" /> home.</h1>
            </div>
            <button className="round-add" onClick={() => setIsComposerOpen(true)} aria-label="Add a waypoint"><Plus size={20} /></button>
          </div>

          <div className="sector-card">
            <div className="sector-copy">
              <div className="card-kicker">THIS SECTOR</div>
              <strong>First steps</strong>
              <p>Keep exploring the streets close to home. Your map grows with every drive.</p>
              <button className="text-button" onClick={() => setToast('Sector detail is being shaped for the next milestone')}>View sector details <ChevronRight size={14} /></button>
            </div>
            <div className="progress-orb" aria-label="Sector exploration 18 percent">
              <span>18%</span>
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
                <button key={waypoint.id} className="place-row" onClick={() => mapRef.current?.flyTo({ center: [waypoint.location.lng, waypoint.location.lat], zoom: 15.5, duration: 800 })}>
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
