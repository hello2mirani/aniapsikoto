const cheerio = require("cheerio");
const { fetchNekostreamEpisode } = require("./nekostream-mapper");
const { resolveEmbedStream } = require("./embed-resolver");
const { fetchJikanAnime } = require("./jikan");
const { ScrapeSession, cleanText, normalizeTitle } = require("./http");

const BASE = "https://anikototv.to";

function emptyBuckets() {
  return { sub: [], dub: [], raw: [] };
}

function bucketKey(category) {
  if (category === "hsub") return "sub";
  return category;
}

async function searchAnikoto(session, title) {
  const html = await session.text(
    `${BASE}/filter?keyword=${encodeURIComponent(title)}`,
  );
  const $ = cheerio.load(html);
  const results = [];

  $(".item").each((_, el) => {
    const href =
      $(el).find("a.name.d-title").attr("href") ??
      $(el).find("a[href*='/watch/']").first().attr("href") ??
      "";
    const match = href.match(/\/watch\/([^/?#]+)/);
    if (!match?.[1]) return;

    const slug = match[1];
    if (slug.includes("/ep-")) return;

    const name =
      cleanText($(el).find("a.name.d-title").text()) ||
      cleanText($(el).find("img").attr("alt")) ||
      slug.replace(/-/g, " ");

    const subCount =
      Number(
        cleanText($(el).find(".ep-status.sub span").text()).match(/\d+/)?.[0],
      ) || 0;
    const dubCount =
      Number(
        cleanText($(el).find(".ep-status.dub span").text()).match(/\d+/)?.[0],
      ) || 0;

    if (!results.some((item) => item.slug === slug)) {
      results.push({ slug, name, subCount, dubCount });
    }
  });

  if (results.length) return results;

  const fallbackMatches = [...html.matchAll(/\/watch\/([a-z0-9-]+)/gi)];
  for (const match of fallbackMatches) {
    const slug = match[1];
    if (slug.includes("ep-") || results.some((item) => item.slug === slug)) {
      continue;
    }
    results.push({ slug, name: slug.replace(/-/g, " "), subCount: 0, dubCount: 0 });
  }

  return results;
}

function pickBestAnikotoSlug(results, targetTitle) {
  if (!results.length) return null;

  const target = normalizeTitle(targetTitle);
  const scored = results.map((item) => {
    const name = normalizeTitle(item.name);
    const slug = normalizeTitle(item.slug.replace(/-/g, " "));
    let score = 0;

    if (name === target || slug === target) score += 1000;
    if (name.startsWith(target) || slug.startsWith(target)) score += 500;
    if (name.includes(target) || slug.includes(target)) score += 100;
    score += item.subCount;
    score += Math.floor(item.dubCount / 2);

    return { ...item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.slug ?? null;
}

function parseWatchMeta(html) {
  const $ = cheerio.load(html);
  const animeId = cleanText($("#watch-main").attr("data-id"));
  const slugMatch = cleanText($("#watch-main").attr("data-url")).match(
    /\/watch\/([^/?#]+)/,
  );
  const title = cleanText($("h1[itemprop='name'].title.d-title").text());

  return {
    animeId,
    slug: slugMatch?.[1] ?? "",
    title,
  };
}

async function fetchEpisodeMeta(session, animeId, slug, episodeNumber) {
  const payload = await session.json(
    `${BASE}/ajax/episode/list/${animeId}`,
    {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE}/watch/${slug}/ep-${episodeNumber}`,
      },
    },
  );

  const html = payload.result ?? "";
  const $ = cheerio.load(html);
  const anchor = $(`a[data-num="${episodeNumber}"]`).first();

  if (!anchor.length) {
    throw new Error(`Episode ${episodeNumber} not found on AniKoto`);
  }

  return {
    serverIds: cleanText(anchor.attr("data-ids")).replace(/^\\?["']|\\?["']$/g, ""),
    timestamp: cleanText(anchor.attr("data-timestamp")),
    malId: cleanText(anchor.attr("data-mal")),
  };
}

function parseServerListHtml(html) {
  const $ = cheerio.load(html);
  const servers = [];

  $(".servers .type").each((_, typeEl) => {
    const category = cleanText($(typeEl).attr("data-type")).toLowerCase();
    if (!["sub", "dub", "raw", "hsub"].includes(category)) return;

    $(typeEl)
      .find("li[data-link-id]")
      .each((__, liEl) => {
        const linkId = cleanText($(liEl).attr("data-link-id"));
        if (!linkId) return;
        servers.push({
          category,
          linkId,
          name: cleanText($(liEl).text()) || "Server",
        });
      });
  });

  return servers;
}

async function fetchServerList(session, slug, episodeNumber, serverIds) {
  const payload = await session.json(
    `${BASE}/ajax/server/list?servers=${encodeURIComponent(serverIds)}`,
    {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: `${BASE}/watch/${slug}/ep-${episodeNumber}`,
      },
    },
  );

  return parseServerListHtml(payload.result ?? "");
}

function decodeBase64Maybe(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("http")) return trimmed;
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
    return decoded.startsWith("http") ? decoded : undefined;
  } catch {
    return undefined;
  }
}

function buildStreamFromUrl(serverName, category, url, embedUrl) {
  if (!url && !embedUrl) return null;

  const streamUrl = url ?? embedUrl ?? "";
  return {
    serverName,
    category,
    embedUrl,
    m3u8: streamUrl.includes(".m3u8") ? streamUrl : undefined,
    mp4: streamUrl && !streamUrl.includes(".m3u8") ? streamUrl : undefined,
    type: streamUrl.includes(".m3u8") ? "hls" : streamUrl ? "mp4" : undefined,
    subtitles: [],
  };
}

async function fetchMapperServers(session, malId, slug, timestamp, episodeNumber) {
  const buckets = emptyBuckets();

  try {
    const data = await session.json(
      `${BASE}/ajax/mapper/${malId}/${encodeURIComponent(slug)}/${encodeURIComponent(timestamp)}`,
      {
        headers: {
          Referer: `${BASE}/watch/${slug}/ep-${episodeNumber}`,
        },
      },
    );

    for (const [provider, sources] of Object.entries(data)) {
      if (sources?.sub?.url) {
        const decoded = decodeBase64Maybe(sources.sub.url);
        if (decoded) {
          buckets.sub.push({
            serverName: `${provider} SUB`,
            category: "sub",
            embedUrl: decoded,
            m3u8: decoded.includes(".m3u8") ? decoded : undefined,
            mp4: decoded.includes(".m3u8") ? undefined : decoded,
            type: decoded.includes(".m3u8") ? "hls" : "mp4",
            subtitles: [],
          });
        }
      }

      if (sources?.dub?.url) {
        const decoded = decodeBase64Maybe(sources.dub.url);
        if (decoded) {
          buckets.dub.push({
            serverName: `${provider} DUB`,
            category: "dub",
            embedUrl: decoded,
            m3u8: decoded.includes(".m3u8") ? decoded : undefined,
            mp4: decoded.includes(".m3u8") ? undefined : decoded,
            type: decoded.includes(".m3u8") ? "hls" : "mp4",
            subtitles: [],
          });
        }
      }
    }
  } catch {
    // optional
  }

  return buckets;
}

async function fetchNekostreamFallback(malId, episodeNumber) {
  const buckets = emptyBuckets();

  try {
    const data = await fetchNekostreamEpisode(malId, episodeNumber);

    if (data.sub?.playerUrl || data.sub?.downloadUrl) {
      const playerUrl = decodeBase64Maybe(data.sub.playerUrl ?? "");
      const stream = buildStreamFromUrl(
        "Kiwi-Stream SUB",
        "sub",
        data.sub.downloadUrl,
        playerUrl,
      );
      if (stream) buckets.sub.push(stream);
    }

    if (data.dub?.playerUrl || data.dub?.downloadUrl) {
      const playerUrl = decodeBase64Maybe(data.dub.playerUrl ?? "");
      const stream = buildStreamFromUrl(
        "Kiwi-Stream DUB",
        "dub",
        data.dub.downloadUrl,
        playerUrl,
      );
      if (stream) buckets.dub.push(stream);
    }
  } catch {
    // optional
  }

  return buckets;
}

function mergeBuckets(target, source) {
  target.sub.push(...source.sub);
  target.dub.push(...source.dub);
  target.raw.push(...source.raw);
}

async function resolveAnikotoServer(session, slug, episodeNumber, server) {
  try {
    const payload = await session.json(
      `${BASE}/ajax/server?get=${encodeURIComponent(server.linkId)}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          Referer: `${BASE}/watch/${slug}/ep-${episodeNumber}`,
        },
      },
    );

    const embedUrl = payload.result?.url;
    if (!embedUrl) return null;

    const resolved = await resolveEmbedStream(embedUrl, `${BASE}/`);

    return {
      serverName: server.name,
      category: server.category,
      embedUrl,
      m3u8: resolved.m3u8,
      mp4: resolved.mp4,
      type: resolved.type,
      subtitles: resolved.subtitles,
    };
  } catch {
    return null;
  }
}

async function fetchAnikotoWatchStreams(malId, episodeNumber) {
  if (!Number.isFinite(malId) || malId <= 0) {
    throw new Error("Invalid malId");
  }
  if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) {
    throw new Error("Invalid episode number");
  }

  const anime = await fetchJikanAnime(malId);
  const session = new ScrapeSession(`${BASE}/`);
  const searchResults = await searchAnikoto(session, anime.title);
  const slug = pickBestAnikotoSlug(searchResults, anime.title);

  if (!slug) {
    throw new Error(`No AniKoto match for "${anime.title}"`);
  }

  const watchHtml = await session.text(`${BASE}/watch/${slug}/ep-${episodeNumber}`);
  const watchMeta = parseWatchMeta(watchHtml);

  if (!watchMeta.animeId) {
    throw new Error(`Could not resolve AniKoto anime ID for ${slug}`);
  }

  const episodeMeta = await fetchEpisodeMeta(
    session,
    watchMeta.animeId,
    slug,
    episodeNumber,
  );

  if (!episodeMeta.serverIds) {
    throw new Error(`No server IDs for episode ${episodeNumber}`);
  }

  const servers = await fetchServerList(
    session,
    slug,
    episodeNumber,
    episodeMeta.serverIds,
  );

  const resolved = await Promise.all(
    servers.map((server) =>
      resolveAnikotoServer(session, slug, episodeNumber, server),
    ),
  );

  const buckets = emptyBuckets();
  for (const item of resolved) {
    if (!item) continue;
    buckets[bucketKey(item.category)].push(item);
  }

  mergeBuckets(
    buckets,
    await fetchMapperServers(
      session,
      malId,
      slug,
      episodeMeta.timestamp,
      episodeNumber,
    ),
  );

  if (!buckets.sub.length && !buckets.dub.length && !buckets.raw.length) {
    mergeBuckets(buckets, await fetchNekostreamFallback(malId, episodeNumber));
  }

  if (!buckets.sub.length && !buckets.dub.length && !buckets.raw.length) {
    throw new Error(
      `No stream servers resolved for ${slug} episode ${episodeNumber}`,
    );
  }

  return {
    source: "anikoto",
    malId: Number(episodeMeta.malId) || malId,
    episodeNumber,
    title: watchMeta.title || anime.title,
    slug,
    anilistId: anime.anilistId,
    ...buckets,
  };
}

module.exports = { fetchAnikotoWatchStreams };
