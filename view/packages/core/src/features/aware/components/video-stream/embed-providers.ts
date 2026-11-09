type EmbedProvider = {
  pattern: RegExp;
  toEmbedUrl: (match: RegExpMatchArray, hostname?: string) => string;
};

const EMBED_PROVIDERS: EmbedProvider[] = [
  // YouTube: youtube.com/watch?v=ID, youtube.com/shorts/ID
  {
    pattern: /youtube\.com\/watch\?v=([^&#]+)/,
    toEmbedUrl: (m) => `https://www.youtube.com/embed/${m[1]}`,
  },
  {
    pattern: /youtube\.com\/shorts\/([^?&#]+)/,
    toEmbedUrl: (m) => `https://www.youtube.com/embed/${m[1]}`,
  },
  // YouTube live: youtube.com/live/ID
  {
    pattern: /youtube\.com\/live\/([^?&#]+)/,
    toEmbedUrl: (m) => `https://www.youtube.com/embed/${m[1]}`,
  },
  // YouTube short links: youtu.be/ID
  {
    pattern: /youtu\.be\/([^?&#]+)/,
    toEmbedUrl: (m) => `https://www.youtube.com/embed/${m[1]}`,
  },
  // Vimeo: vimeo.com/ID
  {
    pattern: /vimeo\.com\/(\d+)/,
    toEmbedUrl: (m) => `https://player.vimeo.com/video/${m[1]}`,
  },
  // Dailymotion: dailymotion.com/video/ID
  {
    pattern: /dailymotion\.com\/video\/([^?&#]+)/,
    toEmbedUrl: (m) => `https://www.dailymotion.com/embed/video/${m[1]}`,
  },
];

function matchEmbedProvider(
  url: string,
): { provider: EmbedProvider; match: RegExpMatchArray } | null {
  for (const provider of EMBED_PROVIDERS) {
    const match = url.match(provider.pattern);
    if (match) return { provider, match };
  }
  return null;
}

function isKnownEmbedUrl(url: string): boolean {
  return matchEmbedProvider(url) !== null;
}

export function canEmbedFullscreen(url: string, firstPartyBaseUrl: string): boolean {
  if (isKnownEmbedUrl(url)) return true;

  try {
    const firstPartyUrl = new URL(firstPartyBaseUrl);
    if (firstPartyUrl.origin === "null") return false;
    return new URL(url, firstPartyUrl).origin === firstPartyUrl.origin;
  } catch {
    return false;
  }
}

export function toEmbedUrl(url: string, hostname?: string): string {
  const result = matchEmbedProvider(url);
  if (!result) return url;
  return result.provider.toEmbedUrl(result.match, hostname);
}
