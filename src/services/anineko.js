const cheerio = require("cheerio");
const { resolveEmbedStream } = require("./embed-resolver");
const { fetchJikanAnime } = require("./jikan");
const { ScrapeSession, cleanText, getBestSlug } = require("./http");

const BASE = "https://anineko.to";
const LANG_BUCKETS = ["sub", "dub", "raw", "hsub"];

function emptyBuckets() {
  return { sub: [], dub: [], raw: [] };
}

function bucketKey(category) {
  if (category === "hsub") return "sub";
  return category;
}

async function searchAnineko(session, title) {
  const html = await session.text(
    `${BASE}/browser?keyword=${encodeURIComponent(title)}`,
  );
  const $ = cheerio.load(html);
  const results = [];

  $('a[href^="/watch/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const slug = href.replace(/^\/watch\//, "").split("/")[0];
    if (!slug || slug.includes("ep-")) return;

    const name =
      cleanText($(el).find(".nv-anime-title").text()) ||
      cleanText($(el).attr("alt")) ||
      cleanText($(el).text()) ||
      slug.replace(/-/g, " ");

    if (!results.some((item) => item.slug === slug)) {
      results.push({ slug, name });
    }
  });

  return results;
}

function parseWatchServers(html) {
  const $ = cheerio.load(html);
  const grouped = new Map();

  for (const category of LANG_BUCKETS) {
    grouped.set(category, []);
  }

  $(".lang-group[data-id]").each((_, groupEl) => {
    const category = cleanText($(groupEl).attr("data-id")).toLowerCase();
    if (!LANG_BUCKETS.includes(category)) return;

    $(groupEl)
      .find(".server-video")
      .each((__, btnEl) => {
        const embedUrl = cleanText($(btnEl).attr("data-video"));
        if (!embedUrl) return;

        const name = cleanText($(btnEl).text())
          .replace(/(Sort Sub|DUB|RAW|HSUB)/gi, "")
          .trim();

        grouped.get(category).push({
          name: name || "Server",
          embedUrl,
        });
      });
  });

  return grouped;
}

async function resolveServer(category, server) {
  try {
    const resolved = await resolveEmbedStream(server.embedUrl, `${BASE}/`);
    if (!resolved.m3u8 && !resolved.mp4) return null;

    return {
      serverName: server.name,
      category,
      embedUrl: server.embedUrl,
      m3u8: resolved.m3u8,
      mp4: resolved.mp4,
      type: resolved.type,
      subtitles: resolved.subtitles,
    };
  } catch {
    return null;
  }
}

async function fetchAninekoWatchStreams(malId, episodeNumber) {
  if (!Number.isFinite(malId) || malId <= 0) {
    throw new Error("Invalid malId");
  }
  if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) {
    throw new Error("Invalid episode number");
  }

  const anime = await fetchJikanAnime(malId);
  const session = new ScrapeSession(`${BASE}/`);
  const results = await searchAnineko(session, anime.title);
  const slug = getBestSlug(results, anime.title);

  if (!slug) {
    throw new Error(`No AniNeko match for "${anime.title}"`);
  }

  const watchHtml = await session.text(`${BASE}/watch/${slug}/ep-${episodeNumber}`);
  const grouped = parseWatchServers(watchHtml);
  const buckets = emptyBuckets();

  const tasks = [];
  for (const category of LANG_BUCKETS) {
    for (const server of grouped.get(category) ?? []) {
      tasks.push(resolveServer(category, server));
    }
  }

  const resolved = await Promise.all(tasks);
  for (const item of resolved) {
    if (!item) continue;
    buckets[bucketKey(item.category)].push(item);
  }

  if (!buckets.sub.length && !buckets.dub.length && !buckets.raw.length) {
    throw new Error(
      `No stream servers resolved for ${slug} episode ${episodeNumber}`,
    );
  }

  return {
    source: "anineko",
    malId,
    episodeNumber,
    title: anime.title,
    slug,
    anilistId: anime.anilistId,
    ...buckets,
  };
}

module.exports = { fetchAninekoWatchStreams };
