// geocode-place — a pure transform. No imports, no network, no disk.
//
// The platform fetched the geocoding response; this picks the single best match
// and returns it in the shape a caller can act on.
//
// It returns the country and admin region alongside the coordinates on purpose.
// A bare lat/lon gives a caller no way to notice that "Springfield" resolved to
// the wrong one of forty, and a dependent tool would carry that error silently.

export function transform({ input, responses }) {
  const body = responses.geo?.body ?? {};
  const hit = (body.results ?? [])[0];

  if (!hit) {
    // A thrown transform is recorded as a failed call rather than becoming an
    // empty success, which would enter the log as a working call.
    throw new Error(`no place matched "${input.place}"`);
  }

  return {
    query: input.place,
    lat: hit.latitude,
    lon: hit.longitude,
    resolved: {
      name: hit.name ?? null,
      region: hit.admin1 ?? null,
      country: hit.country ?? null,
      country_code: hit.country_code ?? null,
      population: hit.population ?? null,
      timezone: hit.timezone ?? null,
    },
  };
}
