"use no memo";

import { Text } from "react-native";

export function HighlightText({
  text,
  ranges,
  className,
  highlightClassName,
}: {
  text: string;
  ranges: number[];
  className: string;
  highlightClassName: string;
}) {
  if (ranges.length === 0) {
    return (
      <Text className={className} numberOfLines={1}>
        {text}
      </Text>
    );
  }

  const highlighted = new Set<number>();
  for (let i = 0; i < ranges.length; i += 2) {
    const start = ranges[i]!;
    const end = ranges[i + 1]!;
    for (let j = start; j < end; j++) highlighted.add(j);
  }

  const parts: { text: string; isMatch: boolean }[] = [];
  let current = "";
  let currentIsMatch = false;

  for (let i = 0; i < text.length; i++) {
    const isMatch = highlighted.has(i);
    if (isMatch !== currentIsMatch && current) {
      parts.push({ text: current, isMatch: currentIsMatch });
      current = "";
    }
    current += text[i];
    currentIsMatch = isMatch;
  }
  if (current) parts.push({ text: current, isMatch: currentIsMatch });

  return (
    <Text className={className} numberOfLines={1}>
      {parts.map((part, i) =>
        part.isMatch ? (
          <Text key={i} className={highlightClassName}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}
