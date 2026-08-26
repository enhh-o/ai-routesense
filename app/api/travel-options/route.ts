export const runtime = "edge";

type AmapPlace = {
  name: string;
  longitude: number;
  latitude: number;
  cityCode: string;
  adcode: string;
};

function getText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

async function findPlace(query: string, key: string): Promise<AmapPlace> {
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.search = new URLSearchParams({
    key,
    keywords: query,
    offset: "1",
    page: "1",
    extensions: "base",
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const body = (await response.json()) as unknown;
    const record = getRecord(body);
    if (!response.ok || getText(record?.status) !== "1") {
      throw new Error("地点服务暂不可用");
    }
    const poi = getRecord(getArray(record?.pois)[0]);
    const [longitude, latitude] = getText(poi?.location).split(",").map(Number);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      throw new Error("未找到可用地点");
    }
    return {
      name: getText(poi?.name) || query,
      longitude,
      latitude,
      cityCode: getText(poi?.citycode),
      adcode: getText(poi?.adcode),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function distanceKm(origin: AmapPlace, destination: AmapPlace) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const latitude1 = toRadians(origin.latitude);
  const latitude2 = toRadians(destination.latitude);
  const value =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function isSameCity(origin: AmapPlace, destination: AmapPlace) {
  if (origin.cityCode && destination.cityCode) {
    return origin.cityCode === destination.cityCode;
  }
  return Boolean(
    origin.adcode &&
      destination.adcode &&
      origin.adcode.slice(0, 4) === destination.adcode.slice(0, 4),
  );
}

function getTravelOptions(origin: AmapPlace, destination: AmapPlace) {
  const directDistanceKm = distanceKm(origin, destination);
  const roundedDistanceKm = Math.max(1, Math.round(directDistanceKm));
  const nearby = isSameCity(origin, destination) || directDistanceKm <= 80;

  if (nearby) {
    return {
      scope: "同城 / 近郊",
      distanceKm: roundedDistanceKm,
      options: ["公共交通", "打车", "自驾"],
      note: `两地直线约 ${roundedDistanceKm} 公里，属于同城或近郊短途；已隐藏飞机、高铁和普通火车。`,
    };
  }
  if (directDistanceKm <= 350) {
    return {
      scope: "短途跨城",
      distanceKm: roundedDistanceKm,
      options: ["高铁", "普通火车", "长途汽车", "自驾"],
      note: `两地直线约 ${roundedDistanceKm} 公里，优先展示地面交通；飞机通常不划算，已隐藏。`,
    };
  }
  if (directDistanceKm <= 800) {
    return {
      scope: "中程跨城",
      distanceKm: roundedDistanceKm,
      options: ["高铁", "普通火车", "自驾", "长途汽车"],
      note: `两地直线约 ${roundedDistanceKm} 公里，优先比较高铁、火车和自驾；是否有合适航班仍需按日期核验。`,
    };
  }
  return {
    scope: "远程跨城",
    distanceKm: roundedDistanceKm,
    options: ["飞机", "高铁", "普通火车", "自驾"],
    note: `两地直线约 ${roundedDistanceKm} 公里，可在飞机与铁路之间结合预算和出发日期选择。`,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const originQuery = (url.searchParams.get("origin") || "").trim().slice(0, 80);
  const destinationQuery = (url.searchParams.get("destination") || "")
    .trim()
    .slice(0, 80);
  const key = process.env.AMAP_MAPS_API_KEY?.trim();
  if (!originQuery || !destinationQuery) {
    return Response.json({ error: "请先填写出发地和目的地。" }, { status: 400 });
  }
  if (!key) {
    return Response.json({ error: "交通方式服务暂未配置。" }, { status: 424 });
  }
  try {
    const [origin, destination] = await Promise.all([
      findPlace(originQuery, key),
      findPlace(destinationQuery, key),
    ]);
    return Response.json(getTravelOptions(origin, destination), {
      headers: { "Cache-Control": "public, max-age=86400" },
    });
  } catch {
    return Response.json(
      { error: "暂时无法判断两地距离，请先让系统自动选择。" },
      { status: 502 },
    );
  }
}
