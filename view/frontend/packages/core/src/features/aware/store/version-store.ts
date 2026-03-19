import { useEntityStore } from "./entity-store";

export function getVersionLabel(
  version: string | null,
  updateAvailable?: string | null,
): string | null {
  if (!version) return null;
  const v = version.startsWith("v") ? version : `v${version}`;
  const update = updateAvailable ? ` ↑ v${updateAvailable}` : "";
  return `${v}${update} · INSECURE`;
}

export function useVersion(): string | null {
  return useEntityStore((s) => s.hydrisVersion);
}

export function useUpdateAvailable(): string | null {
  return useEntityStore((s) => s.hydrisUpdateAvailable);
}

export function useVersionLabel(): string | null {
  return useEntityStore((s) => getVersionLabel(s.hydrisVersion, s.hydrisUpdateAvailable));
}
