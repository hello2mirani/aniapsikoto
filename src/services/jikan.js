async function fetchJikanAnime(malId) {
  const response = await fetch(`https://api.jikan.moe/v4/anime/${malId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Jikan lookup failed (${response.status}) for MAL ${malId}`);
  }

  const json = await response.json();
  const data = json.data;
  if (!data?.title) {
    throw new Error(`Anime not found for MAL ID ${malId}`);
  }

  const anilistLink = data.external?.find((item) =>
    item.name?.toLowerCase().includes("anilist"),
  );
  const anilistId = anilistLink?.url
    ? Number(anilistLink.url.split("/").filter(Boolean).pop())
    : null;

  return {
    malId: data.mal_id ?? malId,
    title: data.title_english || data.title,
    titleEnglish: data.title_english ?? undefined,
    anilistId: Number.isFinite(anilistId) ? anilistId : null,
  };
}

module.exports = { fetchJikanAnime };
