// air-by-place — the first moon. A pure transform over two other tools.
//
// It opens no connection and declares no allowlist. Everything it needs arrives
// in `tools`, already executed by the platform: it cannot choose a dependency at
// run time, cannot pass one anything that was not written down at publication,
// and never learns that a registry exists.
//
// That is the same arrangement as `responses` for HTTP, for the same reason.
// The sandbox has no route and no credentials, so a tool cannot reach another
// tool any more than it can reach the internet — and the platform mediating is
// what makes the dependency reviewable and the call recordable.

export function transform({ input, tools }) {
  const where = tools.where;
  const air = tools.air;

  return {
    place: {
      asked: input.place,
      resolved: [where.resolved.name, where.resolved.region, where.resolved.country]
        .filter(Boolean).join(", "),
      lat: where.lat,
      lon: where.lon,
    },
    observed_at: air.observed_at,
    index: air.index,
    particulates: air.particulates,
    summary: `${where.resolved.name ?? input.place}: ${air.summary}`,
  };
}
