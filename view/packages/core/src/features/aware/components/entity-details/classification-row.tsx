import { InfoRow } from "@hydris/ui/info-row";
import { Text } from "react-native";

import type { TaxonomyEntry } from "../../../../lib/api/use-track-utils";
import { formatTaxonomyPath } from "../../../../lib/api/use-track-utils";

function Confidence({ value }: { value: number }) {
  return <Text className="text-foreground/90 font-mono text-xs">{Math.round(value * 100)}%</Text>;
}

type ClassificationRowProps = { entries: TaxonomyEntry[]; fallback?: string };

export function ClassificationRow({ entries, fallback }: ClassificationRowProps) {
  if (entries.length === 0) {
    return <InfoRow label="Classification" value={fallback || "Unknown"} />;
  }

  return entries.map(({ path, confidence }, index) => {
    const { text, tailLength } = formatTaxonomyPath(path);

    return (
      <InfoRow
        key={index}
        label="Classification"
        value={text}
        tailLength={tailLength}
        trailing={confidence !== undefined && <Confidence value={confidence} />}
      />
    );
  });
}
