const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseSetCookie(header) {
  const [pair] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  return {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
  };
}

class ScrapeSession {
  constructor(referer) {
    this.referer = referer;
    this.cookies = new Map();
  }

  cookieHeader() {
    if (!this.cookies.size) return undefined;
    return [...this.cookies.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  storeCookies(response) {
    const headers = response.headers;
    const setCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : [];

    if (setCookies.length) {
      for (const header of setCookies) {
        const parsed = parseSetCookie(header);
        if (parsed) this.cookies.set(parsed.name, parsed.value);
      }
      return;
    }

    const single = response.headers.get("set-cookie");
    if (single) {
      const parsed = parseSetCookie(single);
      if (parsed) this.cookies.set(parsed.name, parsed.value);
    }
  }

  async fetch(url, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", DEFAULT_UA);
    headers.set("Referer", this.referer);
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) headers.set("Cookie", cookieHeader);

    const response = await fetch(url, {
      ...init,
      headers,
      cache: "no-store",
    });
    this.storeCookies(response);
    return response;
  }

  async text(url, init = {}) {
    const response = await this.fetch(url, init);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return response.text();
  }

  async json(url, init = {}) {
    const response = await this.fetch(url, init);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return response.json();
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function installmentMeta(value) {
  const text = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const season =
    text.match(/(?:season|series)\s*(\d+)/)?.[1] ??
    text.match(/(\d+)(?:st|nd|rd|th)?\s*(?:season|series)/)?.[1] ??
    text.match(/\bs(\d+)\b/)?.[1];
  const part =
    text.match(/(?:part|cour)\s*(\d+)/)?.[1] ??
    text.match(/(\d+)(?:st|nd|rd|th)?\s*(?:part|cour)/)?.[1];

  return {
    season: season ? Number(season) : null,
    part: part ? Number(part) : null,
  };
}

function titleTokens(value) {
  const meta = installmentMeta(value);
  const installmentNumbers = new Set(
    [meta.season, meta.part].filter(Number.isFinite).map(String),
  );

  return [
    ...new Set(
      cleanText(value)
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter(Boolean)
        .filter((token) => !["season", "series", "part", "cour"].includes(token))
        .filter((token) => {
          const ordinal = token.match(/^(\d+)(?:st|nd|rd|th)$/)?.[1];
          return !installmentNumbers.has(ordinal ?? token);
        }),
    ),
  ];
}

function scoreTitleMatch(candidateTitle, targetTitle) {
  const candidate = normalizeTitle(candidateTitle);
  const target = normalizeTitle(targetTitle);
  if (!candidate || !target) return Number.NEGATIVE_INFINITY;
  if (candidate === target) return 10000;

  const candidateMeta = installmentMeta(candidateTitle);
  const targetMeta = installmentMeta(targetTitle);
  if (
    candidateMeta.season &&
    targetMeta.season &&
    candidateMeta.season !== targetMeta.season
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  if (candidateMeta.part && targetMeta.part && candidateMeta.part !== targetMeta.part) {
    return Number.NEGATIVE_INFINITY;
  }
  if (targetMeta.season && targetMeta.season > 1 && !candidateMeta.season) {
    return Number.NEGATIVE_INFINITY;
  }
  if (targetMeta.part && targetMeta.part > 1 && !candidateMeta.part) {
    return Number.NEGATIVE_INFINITY;
  }
  if (!targetMeta.season && candidateMeta.season && candidateMeta.season > 1) {
    return Number.NEGATIVE_INFINITY;
  }

  const candidateTokens = titleTokens(candidateTitle);
  const targetTokens = titleTokens(targetTitle);
  if (!candidateTokens.length || !targetTokens.length) return Number.NEGATIVE_INFINITY;

  const candidateSet = new Set(candidateTokens);
  const targetSet = new Set(targetTokens);
  const shared = targetTokens.filter((token) => candidateSet.has(token)).length;
  const targetCoverage = shared / targetSet.size;
  const candidateCoverage = shared / candidateSet.size;
  if (targetCoverage < 0.6 || candidateCoverage < 0.5) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = targetCoverage * 1000 + candidateCoverage * 500;
  if (targetMeta.season && candidateMeta.season === targetMeta.season) score += 500;
  if (targetMeta.part && candidateMeta.part === targetMeta.part) score += 250;
  return score;
}

function getBestSlug(results, targetTitle) {
  if (!results.length) return null;
  const scored = results
    .map((item) => ({
      ...item,
      score: Math.max(
        scoreTitleMatch(item.name, targetTitle),
        scoreTitleMatch(item.slug.replace(/-/g, " "), targetTitle),
      ),
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.slug ?? null;
}

module.exports = {
  ScrapeSession,
  cleanText,
  normalizeTitle,
  getBestSlug,
  scoreTitleMatch,
};
