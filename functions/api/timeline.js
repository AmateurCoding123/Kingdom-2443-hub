export async function onRequestGet(context) {
  const cache = caches.default;
  const cacheKey = new Request("https://kingdom-2443-hub.pages.dev/api/timeline-cache");

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const upstream = await fetch("https://kingshotoptimizer.com/api/kvk-timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kingdomId: 2443 }),
    });

    if (!upstream.ok) throw new Error("Upstream returned " + upstream.status);

    const data = await upstream.text();
    const response = new Response(data, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: "Timeline unavailable", detail: String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
