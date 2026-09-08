const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const requestUrl = new URL(request.url, `https://${request.headers.host || 'my-maps-alpha.vercel.app'}`)
  const query = requestUrl.searchParams.get('q')?.trim()
  if (!query) return response.status(400).json({ error: 'A search query is required' })

  const upstreamUrl = new URL(NOMINATIM_ENDPOINT)
  upstreamUrl.search = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '8',
    addressdetails: '1',
    'accept-language': 'en',
  }).toString()

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://my-maps-alpha.vercel.app/',
        'User-Agent': 'My-Maps/0.1 (personal exploration map)',
      },
    })
    const payload = await upstreamResponse.json()
    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
    response.setHeader('Access-Control-Allow-Origin', '*')
    return response.status(upstreamResponse.status).json(payload)
  } catch {
    return response.status(502).json({ error: 'External search is unavailable' })
  }
}
