export const runtime = "edge";

interface WikipediaPage {
  pageid?: number;
  title?: string;
  pageimage?: string;
  thumbnail?: {
    source?: string;
    width?: number;
    height?: number;
  };
  imageinfo?: Array<{
    thumburl?: string;
    url?: string;
  }>;
}

interface WikipediaResponse {
  query?: {
    pages?: Record<string, WikipediaPage>;
  };
}

interface PlaceImageResult {
  imageUrl: string;
  title: string;
  sourceUrl: string;
  provider: string;
  width?: number | null;
  height?: number | null;
}

const WIKIPEDIA_API = "https://zh.wikipedia.org/w/api.php";
const WIKIMEDIA_COMMONS_API = "https://commons.wikimedia.org/w/api.php";

function buildWikipediaUrl(name: string, search = false) {
  const url = new URL(WIKIPEDIA_API);
  const params: Record<string, string> = {
    action: "query",
    format: "json",
    formatversion: "2",
    redirects: "1",
    prop: "pageimages",
    piprop: "thumbnail|name",
    pithumbsize: "960",
    pilicense: "free",
    origin: "*",
  };
  if (search) {
    params.generator = "search";
    params.gsrsearch = name;
    params.gsrnamespace = "0";
    params.gsrlimit = "3";
  } else {
    params.titles = name;
  }
  url.search = new URLSearchParams(params).toString();
  return url;
}

async function fetchWikipediaPages(name: string, search = false) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(buildWikipediaUrl(name, search), {
      headers: {
        "Api-User-Agent":
          "RouteSense/1.0 (https://routesense-ai-routing.enhenhen.chatgpt.site)",
      },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body = (await response.json()) as WikipediaResponse;
    return Object.values(body.query?.pages ?? {});
  } finally {
    clearTimeout(timeout);
  }
}

function selectPage(pages: WikipediaPage[]) {
  return pages.find((page) => page.thumbnail?.source && page.pageimage);
}

async function resolveWikipediaPage(name: string, city: string) {
  let page = selectPage(await fetchWikipediaPages(name));
  if (!page) {
    page = selectPage(
      await fetchWikipediaPages([name, city].filter(Boolean).join(" "), true),
    );
  }
  return page;
}

async function resolveCommonsImage(name: string, city: string) {
  const url = new URL(WIKIMEDIA_COMMONS_API);
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: [name, city].filter(Boolean).join(" "),
    gsrnamespace: "6",
    gsrlimit: "5",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "960",
    origin: "*",
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: {
        "Api-User-Agent":
          "RouteSense/1.0 (https://routesense-ai-routing.enhenhen.chatgpt.site)",
      },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as WikipediaResponse;
    const page = Object.values(body.query?.pages ?? {}).find(
      (item) => item.imageinfo?.[0]?.thumburl || item.imageinfo?.[0]?.url,
    );
    const imageUrl = page?.imageinfo?.[0]?.thumburl || page?.imageinfo?.[0]?.url;
    if (!page || !imageUrl) return undefined;
    return {
      imageUrl,
      title: page.title || name,
      sourceUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || name)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveAmapImage(
  name: string,
  city: string,
  apiKey?: string,
): Promise<PlaceImageResult | undefined> {
  if (!apiKey) return undefined;
  const url = new URL("https://restapi.amap.com/v3/place/text");
  url.search = new URLSearchParams({
    key: apiKey,
    keywords: name,
    city,
    citylimit: city ? "true" : "false",
    extensions: "all",
    offset: "5",
    page: "1",
    output: "JSON",
  }).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return undefined;
    const body = (await response.json()) as {
      status?: string;
      pois?: Array<{
        name?: string;
        photos?: Array<{ title?: string; url?: string }>;
      }>;
    };
    if (body.status !== "1") return undefined;
    const poi = body.pois?.find((item) => item.photos?.some((photo) => photo.url));
    const photo = poi?.photos?.find((item) => item.url);
    const imageUrl = photo?.url?.replace(/^http:/i, "https:");
    if (!imageUrl) return undefined;
    return {
      imageUrl,
      title: photo?.title || poi?.name || name,
      sourceUrl: `https://www.amap.com/search?query=${encodeURIComponent(
        [city, poi?.name || name].filter(Boolean).join(" "),
      )}`,
      provider: "高德地点图片",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isAllowedImageHost(hostname: string) {
  return (
    hostname === "upload.wikimedia.org" ||
    hostname === "amap.com" ||
    hostname.endsWith(".amap.com") ||
    hostname === "autonavi.com" ||
    hostname.endsWith(".autonavi.com")
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name")?.trim().slice(0, 80) ?? "";
  const city = url.searchParams.get("city")?.trim().slice(0, 40) ?? "";
  if (!name) {
    return Response.json({ error: "缺少景点名称。" }, { status: 400 });
  }

  try {
    const apiKey = process.env.AMAP_MAPS_API_KEY?.trim();
    let result: PlaceImageResult | undefined;
    try {
      result = await resolveAmapImage(name, city, apiKey);
    } catch {
      result = undefined;
    }
    if (!result) {
      const page = await resolveWikipediaPage(name, city);
      const commonsImage = page?.thumbnail?.source
        ? undefined
        : await resolveCommonsImage(name, city);
      const imageUrl = page?.thumbnail?.source || commonsImage?.imageUrl;
      if (imageUrl) {
        result = {
          imageUrl,
          width: page?.thumbnail?.width ?? null,
          height: page?.thumbnail?.height ?? null,
          title: commonsImage?.title || page?.title || name,
          sourceUrl:
            commonsImage?.sourceUrl ||
            (page?.pageimage
              ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`
              : `https://zh.wikipedia.org/wiki/${encodeURIComponent(page?.title || name)}`),
          provider: "维基百科 / 维基共享资源",
        };
      }
    }
    if (!result) {
      return Response.json(
        { imageUrl: null, title: name, sourceUrl: null },
        { headers: { "Cache-Control": "public, max-age=3600" } },
      );
    }

    if (url.searchParams.get("format") === "image") {
      const imageUrl = new URL(result.imageUrl);
      if (!isAllowedImageHost(imageUrl.hostname)) {
        return new Response("图片来源无效。", { status: 502 });
      }
      const imageResponse = await fetch(imageUrl, {
        headers: {
          "Api-User-Agent":
            "RouteSense/1.0 (https://routesense-ai-routing.enhenhen.chatgpt.site)",
        },
      });
      if (!imageResponse.ok || !imageResponse.body) {
        return new Response("图片暂时不可用。", { status: 502 });
      }
      return new Response(imageResponse.body, {
        headers: {
          "Content-Type": imageResponse.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const proxiedImageUrl = new URL("/api/place-image", request.url);
    proxiedImageUrl.search = new URLSearchParams({
      name,
      city,
      format: "image",
    }).toString();
    return Response.json(
      {
        imageUrl: `${proxiedImageUrl.pathname}${proxiedImageUrl.search}`,
        width: result.width ?? null,
        height: result.height ?? null,
        title: result.title,
        sourceUrl: result.sourceUrl,
        provider: result.provider,
      },
      { headers: { "Cache-Control": "public, max-age=86400" } },
    );
  } catch {
    return Response.json(
      { imageUrl: null, title: name, sourceUrl: null },
      { headers: { "Cache-Control": "public, max-age=900" } },
    );
  }
}
