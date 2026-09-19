// air-quality — a pure transform. No imports, no network, no disk.
//
// The platform has already fetched everything declared in manifest.json and
// passes the parsed bodies in. This function turns those numbers into an answer
// a caller can act on.

// US AQI breakpoints, from the EPA scale. Kept as data rather than a chain of
// ifs so the thresholds are inspectable in review.
const US_BANDS = [
  [0, 50, "Good", "No precautions needed."],
  [51, 100, "Moderate", "Fine for most people. Unusually sensitive people may want to limit long outdoor exertion."],
  [101, 150, "Unhealthy for sensitive groups", "Children, older adults and people with heart or lung conditions should limit prolonged exertion outdoors."],
  [151, 200, "Unhealthy", "Everyone may feel effects. Limit prolonged outdoor exertion."],
  [201, 300, "Very unhealthy", "Avoid prolonged outdoor exertion."],
  [301, Infinity, "Hazardous", "Stay indoors where possible."],
];

function band(aqi) {
  if (typeof aqi !== "number" || Number.isNaN(aqi)) return null;
  const hit = US_BANDS.find(([lo, hi]) => aqi >= lo && aqi <= hi);
  return hit ? { level: hit[2], advice: hit[3] } : null;
}

export function transform({ input, responses }) {
  const body = responses?.aq?.body;
  const current = body?.current;

  // Upstream returning a shape we did not expect is a failed call, not an empty
  // answer. An empty answer would be recorded as a success and quietly pollute
  // the event log that scoring is computed from.
  if (!current) {
    throw new Error("air-quality: upstream returned no current reading");
  }

  const us = current.us_aqi ?? null;
  const verdict = band(us);

  return {
    location: { lat: input.lat, lon: input.lon, timezone: body.timezone ?? null },
    observed_at: current.time ?? null,
    particulates: {
      pm2_5: current.pm2_5 ?? null,
      pm10: current.pm10 ?? null,
      units: body.current_units?.pm2_5 ?? "ug/m3",
    },
    index: {
      us_aqi: us,
      european_aqi: current.european_aqi ?? null,
    },
    // The part a caller actually wanted: not the number, but whether to go out.
    summary: verdict
      ? `US AQI ${us} — ${verdict.level}. ${verdict.advice}`
      : `US AQI unavailable; PM2.5 is ${current.pm2_5 ?? "unknown"} ug/m3.`,
  };
}
