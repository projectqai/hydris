import { useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Platform, Text, View } from "react-native";

import { cn } from "./lib/utils";

type MiddleTruncateTextProps = {
  text: string;
  tailLength?: number;
  evenSplit?: boolean;
  className?: string;
};

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

const ELLIPSIS = String.fromCharCode(0x2026);

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

// web drops a space at the edge of each part and android ignores a trailing one,
// so this turns the space at the split into a non-breaking one
function splitAt(text: string, index: number): [string, string] {
  const cut = isHighSurrogate(text.charCodeAt(index - 1)) ? index - 1 : index;

  return [
    text.slice(0, cut).replace(/ $/, NO_BREAK_SPACE),
    text.slice(cut).replace(/^ /, NO_BREAK_SPACE),
  ];
}

// web ignores ellipsizeMode, so this clips the text from the left instead
function ClipStart({ text, className }: { text: string; className?: string }) {
  return (
    <View className="min-w-0 shrink flex-row justify-end overflow-hidden">
      <Text className={cn("shrink-0 whitespace-nowrap", className)}>{text}</Text>
    </View>
  );
}

function EvenSplitText({ text, className }: { text: string; className?: string }) {
  if (Platform.OS !== "web") {
    return (
      <Text numberOfLines={1} ellipsizeMode="middle" className={cn("text-right", className)}>
        {text}
      </Text>
    );
  }

  const [head, tail] = splitAt(text, Math.ceil(text.length / 2));

  return (
    <View className="flex-row items-baseline justify-end overflow-hidden">
      <Text numberOfLines={1} className={cn("min-w-0 shrink", className)}>
        {head}
      </Text>
      <ClipStart text={tail} className={className} />
    </View>
  );
}

function EndingOnlyText({ text, className }: { text: string; className?: string }) {
  if (Platform.OS !== "web") {
    return (
      <Text numberOfLines={1} ellipsizeMode="head" className={className}>
        {text}
      </Text>
    );
  }

  return (
    <View className="flex-row items-baseline overflow-hidden">
      <Text className={cn("shrink-0", className)}>{ELLIPSIS}</Text>
      <ClipStart text={text} className={className} />
    </View>
  );
}

// the head shrinks first. once it is narrower than two characters, the text shows only its
// ending behind an ellipsis, until the box grows wider than it was at that point
function SplitText({
  text,
  tailLength,
  className,
}: {
  text: string;
  tailLength: number;
  className?: string;
}) {
  const [head, tail] = splitAt(text, text.length - tailLength);
  const widths = useRef<{ box?: number; head?: number; tail?: number }>({});
  const [endingOnlyAt, setEndingOnlyAt] = useState<number | null>(null);

  const switchWhenHeadIsTooNarrow = () => {
    const { box, head: headWidth, tail: tailWidth } = widths.current;

    if (box === undefined || headWidth === undefined || !tailWidth) return;

    const characterWidth = tailWidth / [...tail].length;

    if (headWidth < characterWidth * 2) setEndingOnlyAt(box);
  };

  const onBoxLayout = (event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    widths.current.box = width;

    // web reports the head and tail widths before the box width, so the check runs here too
    if (endingOnlyAt === null) {
      switchWhenHeadIsTooNarrow();

      return;
    }

    if (width > endingOnlyAt) {
      widths.current.head = undefined;
      widths.current.tail = undefined;
      setEndingOnlyAt(null);
    }
  };

  const onPartLayout = (part: "head" | "tail") => (event: LayoutChangeEvent) => {
    widths.current[part] = event.nativeEvent.layout.width;
    switchWhenHeadIsTooNarrow();
  };

  return (
    <View onLayout={onBoxLayout}>
      {endingOnlyAt === null ? (
        <View className="flex-row items-baseline overflow-hidden">
          <Text
            numberOfLines={1}
            onLayout={onPartLayout("head")}
            className={cn("shrink", className)}
          >
            {head}
          </Text>
          <Text
            numberOfLines={1}
            onLayout={onPartLayout("tail")}
            className={cn("shrink-0", className)}
          >
            {tail}
          </Text>
        </View>
      ) : (
        <EndingOnlyText text={text} className={className} />
      )}
    </View>
  );
}

export function MiddleTruncateText({
  text,
  tailLength = 10,
  evenSplit,
  className,
}: MiddleTruncateTextProps) {
  if (evenSplit) return <EvenSplitText text={text} className={className} />;

  if (text.length <= tailLength * 2) {
    return (
      <Text numberOfLines={1} className={className}>
        {text}
      </Text>
    );
  }

  return <SplitText text={text} tailLength={tailLength} className={className} />;
}
