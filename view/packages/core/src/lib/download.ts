import { Platform } from "react-native";
import ReactNativeBlobUtil from "react-native-blob-util";

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  return value.match(/filename="([^"]+)"/)?.[1] ?? null;
}

async function downloadResponseWeb(res: Response, fallbackName: string): Promise<void> {
  const filename =
    parseContentDispositionFilename(res.headers.get("content-disposition")) ?? fallbackName;
  const objectUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export type EndpointDownloadOpts = {
  url: string;
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  body?: string;
  fallbackFilename: string;
  parentFolder: string;
  mimeType: string;
};

// Fetches url and saves the response body to user storage. Web triggers a
// blob-URL download from a same-origin object URL (the download attribute
// only forces a save on same-origin/blob URLs, and dev runs the engine
// cross-origin). Android writes the body to a cache file and then
// copyToMediaStore moves it into Downloads/<parentFolder>. Skipping Android's
// DownloadManager is deliberate: its content:// URI isn't a real path that
// copyToMediaStore can consume. Throws on non-2xx.
export async function downloadFromEndpoint(opts: EndpointDownloadOpts): Promise<void> {
  const method = opts.method ?? "POST";

  if (Platform.OS === "web") {
    const res = await fetch(opts.url, {
      method,
      headers: opts.headers,
      body: opts.body,
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")).trim() || `HTTP ${res.status}`);
    await downloadResponseWeb(res, opts.fallbackFilename);
    return;
  }

  const tempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${opts.fallbackFilename}`;
  const res = await ReactNativeBlobUtil.config({ fileCache: true, path: tempPath }).fetch(
    method,
    opts.url,
    opts.headers,
    opts.body,
  );
  const status = res.respInfo.status;
  if (status < 200 || status >= 300) {
    // blob-util wrote the response body to tempPath even on non-2xx. read it
    // before cleanup so the engine's real reason surfaces, not just the status.
    const detail = (await Promise.resolve(res.text()).catch(() => "")).trim();
    await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
    throw new Error(detail || `HTTP ${status}`);
  }
  const filename =
    parseContentDispositionFilename(res.respInfo.headers["Content-Disposition"] || null) ??
    opts.fallbackFilename;
  try {
    await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
      { name: filename, parentFolder: opts.parentFolder, mimeType: opts.mimeType },
      "Download",
      tempPath,
    );
  } finally {
    await ReactNativeBlobUtil.fs.unlink(tempPath).catch(() => {});
  }
}
