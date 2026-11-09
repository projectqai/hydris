import tailwindConfig from "@hydris/tailwind-config";
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const customFontSizes = Object.keys(tailwindConfig.theme.extend.fontSize);

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: customFontSizes }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateMiddle(str: string, maxLength = 24): string {
  if (str.length <= maxLength) return str;
  const charsPerSide = Math.floor(maxLength / 2);
  return `${str.slice(0, charsPerSide)}...${str.slice(-charsPerSide)}`;
}

export function formatMinutesSeconds(
  value: number,
  { padMinutes = false }: { padMinutes?: boolean } = {},
): string {
  const totalSeconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const minutes = Math.floor(totalSeconds / 60).toString();
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${padMinutes ? minutes.padStart(2, "0") : minutes}:${seconds}`;
}
