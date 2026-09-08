const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]
const HIGHWAY_FILTER = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service'

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

  const query = `[out:json][timeout:18];way["highway"~"${HIGHWAY_FILTER}"](${minLat},${minLng},${maxLat},${maxLng});out tags geom;`
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const upstreamResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Referer: 'https://my-maps-alpha.vercel.app/',
          'User-Agent': 'My-Maps/0.1 (personal exploration map)',
        },
        body: `data=${encodeURIComponent(query)}`,
      })
      if (!upstreamResponse.ok) continue
      const payload = await upstreamResponse.json()
      response.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800')
      return response.status(200).json(payload)
    } catch {
      // Try the next public Overpass instance.
    }
  }
  return response.status(502).json({ error: 'Local road data is unavailable' })
}
