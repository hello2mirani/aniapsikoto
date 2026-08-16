async function fetchAniListAnime(malId) {
  const response = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: `query ($malId: Int!) { Media(idMal: $malId, type: ANIME) { id idMal title { english romaji native } } }`,
      variables: { malId },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`AniList lookup failed (${response.status}) for MAL ${malId}`);
  }

  const json = await response.json();
  const data = json.data?.Media;
  const title = data?.title?.english || data?.title?.romaji || data?.title?.native;
  if (!data || !title) throw new Error(`Anime not found for MAL ID ${malId}`);

  return {
    malId: data.idMal ?? malId,
    title,
    titleEnglish: data.title?.english ?? undefined,
    anilistId: data.id ?? null,
  };
}

async function fetchJikanAnime(malId) {
  try {
    const response = await fetch(`https://api.jikan.moe/v4/anime/${malId}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Jikan lookup failed (${response.status}) for MAL ${malId}`);

    const json = await response.json();
    const data = json.data;
    if (!data?.title) throw new Error(`Anime not found for MAL ID ${malId}`);

    const anilistLink = data.external?.find((item) => item.name?.toLowerCase().includes("anilist"));
    const anilistId = anilistLink?.url ? Number(anilistLink.url.split("/").filter(Boolean).pop()) : null;

    return {
      malId: data.mal_id ?? malId,
      title: data.title_english || data.title,
      titleEnglish: data.title_english ?? undefined,
      anilistId: Number.isFinite(anilistId) ? anilistId : null,
    };
  } catch (jikanError) {
    try {
      return await fetchAniListAnime(malId);
    } catch (anilistError) {
      throw new Error(`Metadata lookup failed for MAL ${malId}: ${jikanError.message}; ${anilistError.message}`);
    }
  }
}

module.exports = { fetchJikanAnime };
