export type Coordinates = {
  lat: number
  lng: number
}

export type WaypointCategory =
  | 'Home'
  | 'Food'
  | 'Store'
  | 'Gas'
  | 'Landmark'
  | 'Parking'
  | 'Recreation'
  | 'Other'

export type Waypoint = {
  id: string
  name: string
  category: WaypointCategory
  location: Coordinates
  createdAt: string
}

export type TripPoint = Coordinates & {
  recordedAt: string
  accuracyMeters?: number
}

export type Trip = {
  id: string
  startedAt: string
  endedAt?: string
  points: TripPoint[]
  distanceMeters: number
}

export type DiscoveredSegment = {
  segmentId: string
  firstDiscoveredAt: string
  lastSeenAt: string
  tripId?: string
}

export type RoadSegment = {
  segmentId: string
  osmWayId: number
  geometry: [Coordinates, Coordinates]
  highway: string
  name?: string
  sectorId: string
  isMajor: boolean
}

export type RoadDataCache = {
  cacheKey: string
  center: Coordinates
  fetchedAt: string
  segments: RoadSegment[]
}

export type StorageSnapshot = {
  waypoints: Waypoint[]
  trips: Trip[]
  discoveries: DiscoveredSegment[]
}

export const WAYPOINT_CATEGORIES: WaypointCategory[] = [
  'Home',
  'Food',
  'Store',
  'Gas',
  'Landmark',
  'Parking',
  'Recreation',
  'Other',
]

export const CATEGORY_EMOJI: Record<WaypointCategory, string> = {
  Home: '⌂',
  Food: '✦',
  Store: '▦',
  Gas: '↯',
  Landmark: '◆',
  Parking: 'P',
  Recreation: '◌',
  Other: '•',
}
