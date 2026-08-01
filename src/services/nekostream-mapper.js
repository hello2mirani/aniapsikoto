const MAPPER_BASE =
  process.env.NEKOSTREAM_MAPPER_URL ??
  "https://mapper.nekostream.site/api/mal";

function decodeBase64Url(value) {
  if (!value) return undefined;
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8").trim();
    return decoded || undefined;
  } catch {
    return undefined;
  }
}

function firstDownloadValue(input) {
  if (!input?.download) return undefined;
  const values = Object.values(input.download).filter(Boolean);
  return values[0];
}

async function fetchNekostreamEpisode(malId, episodeNumber) {
  const timestamp = Math.floor(Date.now() / 1000);
  const res = await fetch(
    `${MAPPER_BASE}/${malId}/${episodeNumber}/${timestamp}`,
    { cache: "no-store" },
  );

  if (!res.ok) {
    throw new Error(`Nekostream mapper failed (${res.status})`);
  }

  const json = await res.json();
  const players = json["Kiwi-Stream-"] ?? {};
  const downloads = json["Kiwi-Stream"] ?? {};

  return {
    sub: {
      playerUrl: decodeBase64Url(players.sub?.url),
      downloadUrl: firstDownloadValue(downloads.sub),
    },
    dub: {
      playerUrl: decodeBase64Url(players.dub?.url),
      downloadUrl: firstDownloadValue(downloads.dub),
    },
  };
}

module.exports = { fetchNekostreamEpisode };
