const OSM_MAP_ENDPOINT = 'https://api.openstreetmap.org/api/0.6/map'
const ALLOWED_HIGHWAYS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'])

function attributes(source) {
  const result = {}
  for (const match of source.matchAll(/([\w:]+)="([^\"]*)"/g)) result[match[1]] = match[2]
  return result
}

function decodeXml(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function parseOsmMap(xml) {
  const nodes = new Map()
  for (const match of xml.matchAll(/<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g)) {
    const attrs = attributes(match[1])
    if (attrs.id && attrs.lat && attrs.lon) nodes.set(attrs.id, { lat: Number(attrs.lat), lon: Number(attrs.lon) })
  }

  const elements = []
  for (const match of xml.matchAll(/<way\b([^>]*)>([\s\S]*?)<\/way>/g)) {
    const attrs = attributes(match[1])
    const body = match[2]
    const tags = {}
    for (const tag of body.matchAll(/<tag\b([^>]*)\/>/g)) {
      const tagAttrs = attributes(tag[1])
      if (tagAttrs.k && tagAttrs.v) tags[tagAttrs.k] = decodeXml(tagAttrs.v)
    }
    if (!attrs.id || !ALLOWED_HIGHWAYS.has(tags.highway)) continue
    const geometry = []
    for (const node of body.matchAll(/<nd\b([^>]*)\/>/g)) {
      const coordinate = nodes.get(attributes(node[1]).ref)
      if (coordinate) geometry.push(coordinate)
    }
    if (geometry.length >= 2) elements.push({ type: 'way', id: Number(attrs.id), tags: { highway: tags.highway, name: tags.name }, geometry })
  }
  return { elements }
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const requestUrl = new URL(request.url, `https://${request.headers.host || 'my-maps-alpha.vercel.app'}`)
  const values = ['minLat', 'minLng', 'maxLat', 'maxLng'].map((key) => Number(requestUrl.searchParams.get(key)))
  if (values.some((value) => !Number.isFinite(value))) return response.status(400).json({ error: 'A valid bounding box is required' })

  const [minLat, minLng, maxLat, maxLng] = values
  if (maxLat <= minLat || maxLng <= minLng || maxLat - minLat > 0.08 || maxLng - minLng > 0.08) {
    return response.status(400).json({ error: 'Road requests must stay within a small local area' })
  }

  const params = new URLSearchParams({ bbox: `${minLng},${minLat},${maxLng},${maxLat}` })
  try {
    const upstreamResponse = await fetch(`${OSM_MAP_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: 'application/xml',
        Referer: 'https://my-maps-alpha.vercel.app/',
        'User-Agent': 'My-Maps/0.1 (personal exploration map)',
      },
    })
    if (!upstreamResponse.ok) return response.status(upstreamResponse.status).json({ error: 'Local road data is unavailable' })
    const payload = parseOsmMap(await upstreamResponse.text())
    response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
    return response.status(200).json(payload)
  } catch {
    return response.status(502).json({ error: 'Local road data is unavailable' })
  }
}
