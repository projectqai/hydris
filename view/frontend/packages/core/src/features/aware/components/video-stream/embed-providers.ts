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

export function toEmbedUrl(url: string, hostname?: string): string {
  for (const provider of EMBED_PROVIDERS) {
    const match = url.match(provider.pattern);
    if (match) return provider.toEmbedUrl(match, hostname);
  }
  return url;
}
