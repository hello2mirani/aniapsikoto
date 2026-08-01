const { ScrapeSession } = require("./http");

const MEGAPLAY_API_MAP = {
  "vidtube.site": "megaplay-1.buzz",
  "vidplay.site": "megaplay-1.buzz",
  "megaplay.buzz": "megaplay-1.buzz",
  "megaplay-1.buzz": "megaplay-1.buzz",
  "embed.bunkrerrer.com": "megaplay-1.buzz",
};

const DIRECT_SRC_HOSTS = [
  "vivibebe.site",
  "vibeplayer.site",
  "bibiemb.xyz",
  "vibevibe.workers.dev",
];

function decodeMaybe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractSubtitlesFromEmbedUrl(embedUrl) {
  const subtitles = [];
  let parsed;

  try {
    parsed = new URL(embedUrl);
  } catch {
    return subtitles;
  }

  for (const [key, rawValue] of parsed.searchParams.entries()) {
    const value = decodeMaybe(rawValue);
    if (!value.startsWith("http")) continue;

    if (key === "sub" || key.startsWith("caption") || key.startsWith("c1_file")) {
      subtitles.push({
        lang: "en",
        label:
          parsed.get("sub_1") ??
          parsed.get("c1_label") ??
          (key.startsWith("caption") ? "English" : "English"),
        url: value,
        format: value.endsWith(".vtt") ? "vtt" : "srt",
      });
    }
  }

  return subtitles;
}

function extractSubtitlesFromApiData(apiData) {
  const subtitles = [];

  if (Array.isArray(apiData.subtitles)) {
    for (const sub of apiData.subtitles) {
      if (!sub || typeof sub !== "object") continue;
      const url = String(sub.url ?? sub.file ?? "");
      if (!url) continue;
      subtitles.push({
        lang: String(sub.code ?? sub.language ?? "en"),
        label: String(sub.label ?? sub.language ?? "Unknown"),
        url,
        format: String(sub.format ?? "srt"),
      });
    }
  }

  if (Array.isArray(apiData.tracks)) {
    for (const track of apiData.tracks) {
      if (!track || typeof track !== "object") continue;
      if (track.kind !== "subtitles" && track.type !== "subtitles") continue;
      const url = String(track.file ?? track.src ?? "");
      if (!url) continue;
      subtitles.push({
        lang: String(track.srclang ?? track.language ?? "en"),
        label: String(track.label ?? track.language ?? "Unknown"),
        url,
        format: String(track.format ?? "srt"),
      });
    }
  }

  return subtitles;
}

function extractDirectStreamFromHtml(html) {
  const patterns = [
    /const\s+src\s*=\s*["'](https?:\/\/[^"']+)["']/i,
    /file:\s*["'](https?:\/\/[^"']+)["']/i,
    /source:\s*["'](https?:\/\/[^"']+)["']/i,
    /hlsUrl\s*:\s*["'](https?:\/\/[^"']+)["']/i,
    /["']file["']\s*:\s*["'](https?:\/\/[^"']+)["']/i,
    /"(https?:\/\/[^"']+\.m3u8[^"']*)"/i,
    /'(https?:\/\/[^"']+\.m3u8[^"']*)'/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function buildResolvedStream(streamUrl, subtitles, fallbackSubtitles) {
  return {
    m3u8: streamUrl.includes(".m3u8") ? streamUrl : undefined,
    mp4: streamUrl.includes(".m3u8") ? undefined : streamUrl,
    type: streamUrl.includes(".m3u8") ? "hls" : "mp4",
    subtitles: subtitles.length ? subtitles : fallbackSubtitles,
  };
}

async function resolveMegaplayStream(session, embedUrl, html) {
  const dataId =
    html.match(/data-id="(\d+)"/)?.[1] ??
    html.match(/data-realid="([^"]+)"/)?.[1];

  if (!dataId) return null;

  const host = new URL(embedUrl).hostname.replace(/^www\./, "");
  const apiHosts = [
    MEGAPLAY_API_MAP[host],
    "megaplay-1.buzz",
    "megaplay.buzz",
    host,
  ].filter(Boolean);

  for (const apiHost of [...new Set(apiHosts)]) {
    try {
      const apiData = await session.json(
        `https://${apiHost}/ajax/sources/${dataId}`,
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: embedUrl,
            Origin: `https://${host}`,
          },
        },
      );

      const streamUrl = String(
        apiData.source ?? apiData.url ?? apiData.file ?? "",
      );
      if (!streamUrl) continue;

      return {
        streamUrl,
        subtitles: extractSubtitlesFromApiData(apiData),
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function resolveEmbedStream(embedUrl, referer) {
  const subtitles = extractSubtitlesFromEmbedUrl(embedUrl);
  const session = new ScrapeSession(referer);
  const html = await session.text(embedUrl, {
    headers: { Accept: "text/html,*/*" },
  });

  const direct = extractDirectStreamFromHtml(html);
  if (direct) {
    return {
      m3u8: direct.includes(".m3u8") ? direct : undefined,
      mp4: direct.includes(".m3u8") ? undefined : direct,
      type: direct.includes(".m3u8") ? "hls" : "mp4",
      subtitles,
    };
  }

  const host = new URL(embedUrl).hostname.replace(/^www\./, "");
  if (DIRECT_SRC_HOSTS.some((item) => host.includes(item.replace(/^www\./, "")))) {
    return { subtitles };
  }

  const dataId =
    html.match(/data-id="(\d+)"/)?.[1] ??
    html.match(/data-realid="([^"]+)"/)?.[1];

  if (!dataId) {
    const megaplay = await resolveMegaplayStream(session, embedUrl, html);
    if (megaplay) {
      return buildResolvedStream(megaplay.streamUrl, megaplay.subtitles, subtitles);
    }
    return { subtitles };
  }

  const apiHost = MEGAPLAY_API_MAP[host] ?? host;
  try {
    const apiData = await session.json(
      `https://${apiHost}/ajax/sources/${dataId}`,
      {
        headers: {
          Accept: "application/json, text/plain, */*",
          Referer: embedUrl,
          Origin: `https://${host}`,
        },
      },
    );

    const streamUrl = String(
      apiData.source ?? apiData.url ?? apiData.file ?? "",
    );
    const apiSubtitles = extractSubtitlesFromApiData(apiData);

    if (streamUrl) {
      return buildResolvedStream(
        streamUrl,
        apiSubtitles.length ? apiSubtitles : subtitles,
        subtitles,
      );
    }
  } catch {
    // fall through
  }

  const megaplay = await resolveMegaplayStream(session, embedUrl, html);
  if (megaplay) {
    return buildResolvedStream(megaplay.streamUrl, megaplay.subtitles, subtitles);
  }

  return { subtitles };
}

module.exports = { resolveEmbedStream };
