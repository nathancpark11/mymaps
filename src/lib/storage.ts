import type { DiscoveredSegment, RoadDataCache, Trip, Waypoint } from '../types'

const DATABASE_NAME = 'my-maps-local'
const DATABASE_VERSION = 2
const STORE_NAMES = ['waypoints', 'trips', 'discoveries', 'roadData'] as const
type StoreName = (typeof STORE_NAMES)[number]
const STORE_KEYS: Record<StoreName, string> = {
  waypoints: 'id',
  trips: 'id',
  discoveries: 'segmentId',
  roadData: 'cacheKey',
}

const memoryStore: Record<StoreName, unknown[]> = {
  waypoints: [],
  trips: [],
  discoveries: [],
  roadData: [],
}

function canUseIndexedDb() {
  return typeof window !== 'undefined' && 'indexedDB' in window
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      STORE_NAMES.forEach((storeName) => {
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: STORE_KEYS[storeName] })
        }
      })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getAll<T>(storeName: StoreName): Promise<T[]> {
  if (!canUseIndexedDb()) return memoryStore[storeName] as T[]

  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error)
  })
}

async function put<T>(storeName: StoreName, value: T) {
  if (!canUseIndexedDb()) {
    const key = STORE_KEYS[storeName]
    const record = value as Record<string, unknown>
    const existingIndex = memoryStore[storeName].findIndex((item) => (item as Record<string, unknown>)[key] === record[key])
    if (existingIndex >= 0) memoryStore[storeName][existingIndex] = value
    else memoryStore[storeName].push(value)
    return
  }

  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(value)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

export const localStore = {
  listWaypoints: () => getAll<Waypoint>('waypoints'),
  saveWaypoint: (waypoint: Waypoint) => put('waypoints', waypoint),
  listTrips: () => getAll<Trip>('trips'),
  saveTrip: (trip: Trip) => put('trips', trip),
  listDiscoveries: () => getAll<DiscoveredSegment>('discoveries'),
  saveDiscovery: (discovery: DiscoveredSegment) => put('discoveries', discovery),
  getRoadData: async (cacheKey: string) => {
    const records = await getAll<RoadDataCache>('roadData')
    return records.find((record) => record.cacheKey === cacheKey)
  },
  listRoadData: () => getAll<RoadDataCache>('roadData'),
  saveRoadData: (roadData: RoadDataCache) => put('roadData', roadData),
  snapshot: async (): Promise<{ waypoints: Waypoint[]; trips: Trip[]; discoveries: DiscoveredSegment[] }> => ({
    waypoints: await getAll<Waypoint>('waypoints'),
    trips: await getAll<Trip>('trips'),
    discoveries: await getAll<DiscoveredSegment>('discoveries'),
  }),
}
