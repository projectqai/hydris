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
