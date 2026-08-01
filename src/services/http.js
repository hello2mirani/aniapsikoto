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

function getBestSlug(results, targetTitle) {
  if (!results.length) return null;
  const target = normalizeTitle(targetTitle);

  let match = results.find(
    (item) =>
      normalizeTitle(item.slug.replace(/-/g, " ")) === target ||
      normalizeTitle(item.name) === target,
  );
  if (match) return match.slug;

  match = results.find(
    (item) =>
      normalizeTitle(item.name).includes(target) ||
      target.includes(normalizeTitle(item.name)),
  );
  if (match) return match.slug;

  return results[0].slug;
}

module.exports = {
  ScrapeSession,
  cleanText,
  normalizeTitle,
  getBestSlug,
};
