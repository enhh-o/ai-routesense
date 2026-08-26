export const runtime = "edge";

type MapPlace = { name: string; city?: string };
type LocatedPlace = MapPlace & { longitude: number; latitude: number };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parsePlaces(request: Request): MapPlace[] | null {
  const raw = new URL(request.url).searchParams.get("places");
  if (!raw) return null;
  try {
    const values = JSON.parse(raw) as unknown;
    if (!Array.isArray(values) || values.length < 2 || values.length > 6) {
      return null;
    }
    const places = values
      .map((value) => asRecord(value))
      .filter((value): value is Record<string, unknown> => Boolean(value))
      .map((value) => ({
        name: text(value.name).slice(0, 70),
        city: text(value.city).slice(0, 40),
      }));
    return places.length === values.length && places.every((place) => place.name)
      ? places
      : null;
  } catch {
    return null;
  }
}

async function amapJson(url: URL) {
  // High-de calls can occasionally time out or hit a transient QPS limit.
  // Retry once here rather than immediately replacing the map with a schematic.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7_500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error("地图服务暂不可用");
      const body = (await response.json()) as unknown;
      const record = asRecord(body);
      if (text(record?.status) === "1") return record ?? {};
      throw new Error(text(record?.info) || "地图服务未返回结果");
    } catch (error) {
      if (attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 550));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("地图服务暂不可用");
}

async function locatePlace(place: MapPlace, key: string): Promise<LocatedPlace> {
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.search = new URLSearchParams({
    key,
    keywords: place.name,
    city: place.city || "全国",
    citylimit: place.city ? "true" : "false",
    offset: "1",
    page: "1",
  }).toString();
  try {
    const body = await amapJson(url);
    const poi = asRecord(asArray(body.pois)[0]);
    const location = text(poi?.location);
    const [longitude, latitude] = location.split(",").map(Number);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return { ...place, longitude, latitude };
    }
  } catch {
    // The address endpoint below is deliberately tried for landmarks whose POI
    // alias is not recognized by the text-search endpoint.
  }

  const fallbackUrl = new URL("https://restapi.amap.com/v3/geocode/geo");
  fallbackUrl.search = new URLSearchParams({
    key,
    address: [place.city, place.name].filter(Boolean).join(" "),
    city: place.city || "全国",
  }).toString();
  const fallback = await amapJson(fallbackUrl);
  const geocode = asRecord(asArray(fallback.geocodes)[0]);
  const [longitude, latitude] = text(geocode?.location).split(",").map(Number);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error(`无法定位${place.name}`);
  }
  return { ...place, longitude, latitude };
}

function formatPoint(point: LocatedPlace) {
  return `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`;
}

function samplePolyline(value: string, maximum = 14) {
  const points = value.split(";").filter((item) => /^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(item));
  if (points.length <= maximum) return points;
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) => points[Math.round(index * step)]);
}

async function walkingPolyline(origin: LocatedPlace, destination: LocatedPlace, key: string) {
  const url = new URL("https://restapi.amap.com/v5/direction/walking");
  url.search = new URLSearchParams({
    key,
    origin: formatPoint(origin),
    destination: formatPoint(destination),
    show_fields: "polyline",
  }).toString();
  try {
    const body = await amapJson(url);
    const route = asRecord(body.route);
    const path = asRecord(asArray(route?.paths)[0]);
    const parts = asArray(path?.steps)
      .map((value) => text(asRecord(value)?.polyline))
      .flatMap((value) => samplePolyline(value, 7));
    return parts.length >= 2 ? parts : [formatPoint(origin), formatPoint(destination)];
  } catch {
    // A route preview must remain useful when walking calculation is unavailable.
    return [formatPoint(origin), formatPoint(destination)];
  }
}

export async function GET(request: Request) {
  const places = parsePlaces(request);
  const key = process.env.AMAP_MAPS_API_KEY?.trim();
  if (!places || !key) {
    return Response.json({ error: "地图预览暂不可用" }, { status: 424 });
  }

  try {
    const points: LocatedPlace[] = [];
    for (const place of places) points.push(await locatePlace(place, key));

    const routeParts: string[] = [];
    for (let index = 1; index < points.length; index += 1) {
      routeParts.push((await walkingPolyline(points[index - 1], points[index], key)).join(";"));
    }

    const mapUrl = new URL("https://restapi.amap.com/v3/staticmap");
    const markerGroups = points.map((point, index) =>
      `mid,0x16775a,${index + 1}:${formatPoint(point)}`,
    );
    const path = routeParts.flatMap((part) => samplePolyline(part, 12)).join(";");
    const buildStaticMapRequest = (traffic: "0" | "1") => {
      mapUrl.search = new URLSearchParams({
        key,
        size: "750*300",
        scale: "2",
        traffic,
        markers: markerGroups.join("|"),
        paths: `6,0x16775a,0.82,,0:${path || points.map(formatPoint).join(";")}`,
      }).toString();
      return mapUrl.toString();
    };

    let response = await fetch(buildStaticMapRequest("1"));
    let contentType = response.headers.get("content-type") || "";
    // Traffic layers are optional. Retry without them before declaring the map
    // unavailable, because a clear base map is still much better than no map.
    if (!response.ok || !contentType.startsWith("image/")) {
      response = await fetch(buildStaticMapRequest("0"));
      contentType = response.headers.get("content-type") || "";
    }
    if (!response.ok || !contentType.startsWith("image/")) {
      throw new Error("地图图片生成失败");
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=600",
      },
    });
  } catch {
    return Response.json({ error: "暂未能生成当天地图预览" }, { status: 502 });
  }
}
