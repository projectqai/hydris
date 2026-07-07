import { create as createProto } from "@bufbuild/protobuf";
import { ArtifactComponentSchema, EntitySchema } from "@projectqai/proto/world";
import ReactNativeBlobUtil from "react-native-blob-util";

import { baseUrl, worldClient } from "../../lib/api/world-client";
import type { PickedFile } from "../../lib/use-file-picker";

export function startUploadArtifact(
  picked: PickedFile,
  opts: { id: string; contentType: string; label?: string; signal?: AbortSignal },
): { promise: Promise<void>; cancel: () => void } {
  let nativeTask: { cancel: () => void } | null = null;

  const promise = (async () => {
    await worldClient.push({
      changes: [
        createProto(EntitySchema, {
          id: opts.id,
          label: opts.label,
          artifact: createProto(ArtifactComponentSchema, {
            id: opts.id,
            contentType: opts.contentType,
          }),
        }),
      ],
    });

    const url = `${baseUrl}/artifacts/${encodeURIComponent(opts.id)}`;
    if (picked.kind === "web") {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": opts.contentType },
        body: picked.file,
        signal: opts.signal,
      });
      if (!res.ok) throw new Error((await res.text()).trim() || `HTTP ${res.status}`);
      return;
    }
    const task = ReactNativeBlobUtil.fetch(
      "POST",
      url,
      { "Content-Type": opts.contentType },
      ReactNativeBlobUtil.wrap(picked.uri),
    );
    nativeTask = task;
    const res = await task;
    const status = res.respInfo.status;
    if (status < 200 || status >= 300) {
      throw new Error((await res.text()).trim() || `HTTP ${status}`);
    }
  })();

  return { promise, cancel: () => nativeTask?.cancel() };
}
