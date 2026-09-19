// Offline tests for the air-quality tool.
//
// No network. The responses the platform would have fetched are supplied as
// fixtures. A tool that cannot be tested this way is reaching for something it
// failed to declare.

import { test } from "node:test";
import assert from "node:assert/strict";
import { transform } from "./handler.mjs";

// Captured from a real call on 2026-09-19, trimmed to the fields used.
const REAL = {
  aq: {
    body: {
      latitude: 5.6, longitude: -0.19, timezone: "Africa/Accra",
      current_units: { pm10: "ug/m3", pm2_5: "ug/m3", european_aqi: "EAQI", us_aqi: "USAQI" },
      current: { time: "2026-09-19T06:00", pm10: 10.5, pm2_5: 7.5, european_aqi: 25, us_aqi: 50 },
    },
  },
};
const INPUT = { lat: 5.6, lon: -0.19 };

test("returns the reading and a plain-language verdict", () => {
  const out = transform({ input: INPUT, responses: REAL });
  assert.equal(out.index.us_aqi, 50);
  assert.equal(out.particulates.pm2_5, 7.5);
  assert.equal(out.observed_at, "2026-09-19T06:00");
  assert.match(out.summary, /Good/);
});

test("band boundaries land on the right side", () => {
  const at = (us) => transform({
    input: INPUT,
    responses: { aq: { body: { ...REAL.aq.body, current: { ...REAL.aq.body.current, us_aqi: us } } } },
  }).summary;
  assert.match(at(50), /Good/);
  assert.match(at(51), /Moderate/);
  assert.match(at(100), /Moderate/);
  assert.match(at(101), /sensitive groups/);
  assert.match(at(301), /Hazardous/);
});

test("a missing index degrades to the raw particulate reading", () => {
  const out = transform({
    input: INPUT,
    responses: { aq: { body: { ...REAL.aq.body, current: { time: "t", pm2_5: 7.5 } } } },
  });
  assert.equal(out.index.us_aqi, null);
  assert.match(out.summary, /7\.5/);
});

// An unexpected upstream shape must fail the call rather than return an empty
// answer. An empty answer would be logged as a success and pollute the event
// log that scoring is recomputed from.
test("an unusable upstream response throws rather than returning nothing", () => {
  for (const bad of [{}, { aq: {} }, { aq: { body: {} } }, { aq: { body: { current: null } } }]) {
    assert.throws(() => transform({ input: INPUT, responses: bad }), /no current reading/);
  }
});

test("coordinates are echoed back so a result can be attributed to a place", () => {
  const out = transform({ input: INPUT, responses: REAL });
  assert.deepEqual(
    { lat: out.location.lat, lon: out.location.lon, timezone: out.location.timezone },
    { lat: 5.6, lon: -0.19, timezone: "Africa/Accra" },
  );
});
