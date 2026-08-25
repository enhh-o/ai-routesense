export const runtime = "edge";

interface NominatimAddress {
  city?: string;
  town?: string;
  municipality?: string;
  county?: string;
  state?: string;
  province?: string;
  suburb?: string;
  district?: string;
}

interface NominatimReverseResponse {
  display_name?: string;
  address?: NominatimAddress;
  error?: string;
}

function readCoordinate(value: string | null, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const lat = readCoordinate(requestUrl.searchParams.get("lat"), -90, 90);
  const lon = readCoordinate(requestUrl.searchParams.get("lon"), -180, 180);
  if (lat === null || lon === null) {
    return Response.json({ error: "定位坐标无效。" }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "jsonv2",
    addressdetails: "1",
    zoom: "10",
    "accept-language": "zh-CN,zh",
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "RouteSense/1.0 (https://routesense-ai-routing.enhenhen.chatgpt.site)",
        Referer: "https://routesense-ai-routing.enhenhen.chatgpt.site/",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`位置服务返回 HTTP ${response.status}`);
    }
    const body = (await response.json()) as NominatimReverseResponse;
    if (body.error) throw new Error(body.error);
    const address = body.address ?? {};
    const city =
      address.city || address.town || address.municipality || address.county || "";
    const province = address.state || address.province || "";
    const district = address.district || address.suburb || "";
    return Response.json(
      {
        city,
        province,
        district,
        displayName: [district, city, province].filter(Boolean).join("，"),
        attribution: "© OpenStreetMap contributors · Nominatim",
      },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "暂时无法解析当前位置。",
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
