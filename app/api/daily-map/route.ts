export const runtime = "edge";

type MapPlace = { name: string; city?: string };
type LocatedPlace = MapPlace & { longitude: number; latitude: number };
type Coordinate = [number, number];
type RouteSegment = { points: Coordinate[]; actual: boolean };

const MAP_WIDTH = 750;
const MAP_HEIGHT = 300;
const MAP_PADDING = 58;

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
    const [longitude, latitude] = text(poi?.location).split(",").map(Number);
    if (Number.isFinite(longitude) && Number.isFinite(latitude)) {
      return { ...place, longitude, latitude };
    }
  } catch {
    // Some landmarks are only recognized by the geocoding endpoint below.
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

function parseCoordinate(value: string): Coordinate | null {
  const [longitude, latitude] = value.split(",").map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [longitude, latitude]
    : null;
}

function samplePolyline(value: string, maximum = 14) {
  const points = value
    .split(";")
    .map(parseCoordinate)
    .filter((point): point is Coordinate => Boolean(point));
  if (points.length <= maximum) return points;
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) =>
    points[Math.round(index * step)],
  );
}

async function walkingPolyline(
  origin: LocatedPlace,
  destination: LocatedPlace,
  key: string,
): Promise<RouteSegment> {
  const fallback: RouteSegment = {
    points: [
      [origin.longitude, origin.latitude],
      [destination.longitude, destination.latitude],
    ],
    actual: false,
  };
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
    const points = asArray(path?.steps)
      .map((value) => text(asRecord(value)?.polyline))
      .flatMap((value) => samplePolyline(value, 7));
    return points.length >= 2 ? { points, actual: true } : fallback;
  } catch {
    return fallback;
  }
}

function project([longitude, latitude]: Coordinate) {
  const safeLatitude = Math.max(-85, Math.min(85, latitude));
  const sin = Math.sin((safeLatitude * Math.PI) / 180);
  return [
    (longitude + 180) / 360,
    0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  ] as Coordinate;
}

function unproject([x, y]: Coordinate) {
  const longitude = x * 360 - 180;
  const latitude =
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [longitude, latitude] as Coordinate;
}

function calculateViewport(coordinates: Coordinate[]) {
  const projected = coordinates.map(project);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const widthRatio =
    (MAP_WIDTH - MAP_PADDING * 2) / (256 * Math.max(maxX - minX, 0.000001));
  const heightRatio =
    (MAP_HEIGHT - MAP_PADDING * 2) / (256 * Math.max(maxY - minY, 0.000001));
  const zoom = Math.max(
    3,
    Math.min(17, Math.floor(Math.log2(Math.min(widthRatio, heightRatio)))),
  );
  const center = unproject([(minX + maxX) / 2, (minY + maxY) / 2]);
  return { center, zoom, width: MAP_WIDTH, height: MAP_HEIGHT };
}

function overlayHeader(
  points: LocatedPlace[],
  segments: RouteSegment[],
  viewport: ReturnType<typeof calculateViewport>,
) {
  return JSON.stringify({
    points: points.map(
      ({ longitude, latitude }) => [longitude, latitude] as Coordinate,
    ),
    segments,
    viewport,
  });
}

function getEdgeCache() {
  if (typeof caches === "undefined") return null;
  return (caches as CacheStorage & { default?: Cache }).default ?? null;
}

export async function GET(request: Request) {
  const places = parsePlaces(request);
  const key = process.env.AMAP_MAPS_API_KEY?.trim();
  if (!places || !key) {
    return Response.json({ error: "地图预览暂不可用" }, { status: 424 });
  }

  const edgeCache = getEdgeCache();
  let cached: Response | undefined;
  try {
    cached = await edgeCache?.match(request);
  } catch {
    // A cache outage must not prevent a fresh map from being generated.
  }
  if (cached) return cached;

  try {
    const points = await Promise.all(
      places.map((place) => locatePlace(place, key)),
    );
    const segments = await Promise.all(
      points.slice(1).map((point, index) =>
        walkingPolyline(points[index], point, key),
      ),
    );
    const allCoordinates = [
      ...points.map(
        ({ longitude, latitude }) => [longitude, latitude] as Coordinate,
      ),
      ...segments.flatMap((segment) => segment.points),
    ];
    const viewport = calculateViewport(allCoordinates);

    const mapUrl = new URL("https://restapi.amap.com/v3/staticmap");
    const buildStaticMapRequest = (traffic: "0" | "1") => {
      mapUrl.search = new URLSearchParams({
        key,
        size: `${MAP_WIDTH}*${MAP_HEIGHT}`,
        scale: "1",
        traffic,
        location: `${viewport.center[0].toFixed(6)},${viewport.center[1].toFixed(6)}`,
        zoom: String(viewport.zoom),
      }).toString();
      return mapUrl.toString();
    };

    let response = await fetch(buildStaticMapRequest("1"));
    let contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("image/")) {
      response = await fetch(buildStaticMapRequest("0"));
      contentType = response.headers.get("content-type") || "";
    }
    if (!response.ok || !contentType.startsWith("image/")) {
      throw new Error("地图图片生成失败");
    }

    const result = new Response(response.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=604800",
        "X-RouteSense-Overlay": overlayHeader(points, segments, viewport),
      },
    });
    try {
      await edgeCache?.put(request, result.clone());
    } catch {
      // The response remains usable even when edge caching is unavailable.
    }
    return result;
  } catch {
    return Response.json({ error: "暂未能生成当天地图预览" }, { status: 502 });
  }
}
