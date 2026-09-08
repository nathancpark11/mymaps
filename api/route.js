const OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving'

function coordinate(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const requestUrl = new URL(request.url, `https://${request.headers.host || 'my-maps-alpha.vercel.app'}`)
  const startLat = coordinate(requestUrl.searchParams.get('startLat'))
  const startLng = coordinate(requestUrl.searchParams.get('startLng'))
  const endLat = coordinate(requestUrl.searchParams.get('endLat'))
  const endLng = coordinate(requestUrl.searchParams.get('endLng'))
  if ([startLat, startLng, endLat, endLng].some((value) => value == null)) return response.status(400).json({ error: 'A valid route origin and destination are required' })
  if (Math.abs(startLat) > 90 || Math.abs(endLat) > 90 || Math.abs(startLng) > 180 || Math.abs(endLng) > 180) return response.status(400).json({ error: 'Route coordinates are out of range' })

  const coordinates = `${startLng},${startLat};${endLng},${endLat}`
  const query = new URLSearchParams({ overview: 'full', geometries: 'geojson', steps: 'true' })
  try {
    const upstreamResponse = await fetch(`${OSRM_ENDPOINT}/${coordinates}?${query.toString()}`, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://my-maps-alpha.vercel.app/',
        'User-Agent': 'My-Maps/0.1 (personal exploration map)',
      },
    })
    const payload = await upstreamResponse.json()
    response.setHeader('Cache-Control', 'no-store')
    return response.status(upstreamResponse.status).json(payload)
  } catch {
    return response.status(502).json({ error: 'Routing service is unavailable' })
  }
}
