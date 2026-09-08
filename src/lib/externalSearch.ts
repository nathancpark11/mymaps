import type { Coordinates } from '../types'

export type ExternalSearchResult = {
  id: string
  name: string
  detail: string
  location: Coordinates
  kind: string
  sourceUrl?: string
}

type NominatimResult = {
  place_id: number
  display_name: string
  lat: string
  lon: string
  type?: string
  category?: string
  osm_type?: string
  osm_id?: number
}

const SEARCH_ENDPOINT = '/api/search'
const CACHE_KEY = 'my-maps:external-search-cache-v1'
const MIN_REQUEST_GAP_MS = 1_000
let lastRequestAt = 0

function readCache() {
  try {
    return JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, ExternalSearchResult[]>
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, ExternalSearchResult[]>) {
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* caching is optional */ }
}

function toResult(item: NominatimResult): ExternalSearchResult | null {
  const lat = Number(item.lat)
  const lng = Number(item.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const [name, ...detailParts] = item.display_name.split(', ')
  const sourceUrl = item.osm_type && item.osm_id
    ? `https://www.openstreetmap.org/${item.osm_type}/${item.osm_id}`
    : undefined

  return {
    id: `osm_${item.place_id}`,
    name: name || item.display_name,
    detail: detailParts.join(', ') || item.display_name,
    location: { lat, lng },
    kind: item.type || item.category || 'place',
    sourceUrl,
  }
}

export async function searchOutsideMap(query: string, signal?: AbortSignal) {
  const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase()
  if (!normalizedQuery) return []

  const cache = readCache()
  if (cache[normalizedQuery]) return cache[normalizedQuery]

  const timeSinceLastRequest = Date.now() - lastRequestAt
  if (timeSinceLastRequest < MIN_REQUEST_GAP_MS) {
    await new Promise((resolve) => window.setTimeout(resolve, MIN_REQUEST_GAP_MS - timeSinceLastRequest))
  }
  lastRequestAt = Date.now()

  const params = new URLSearchParams({ q: query.trim() })
  const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`External search failed with status ${response.status}`)

  const payload = await response.json() as NominatimResult[]
  const results = payload.map(toResult).filter((item): item is ExternalSearchResult => item !== null)
  cache[normalizedQuery] = results
  writeCache(cache)
  return results
}
