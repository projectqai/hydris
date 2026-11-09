import type { PageTab } from "@hydris/ui/command-palette/palette-reducer";
import { ScrollShadow } from "@hydris/ui/scroll-shadow";
import { SegmentedControl } from "@hydris/ui/segmented-control";
import type { Entity } from "@projectqai/proto/world";
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { DataTabContent, getDataTabs } from "../../configuration-modal/data-tabs";

export function OverviewTabs({
  entity,
  tab,
  onTabChange,
  children,
}: {
  entity: Entity;
  tab: PageTab;
  onTabChange: (tab: PageTab) => void;
  children: ReactNode;
}) {
  const tabs: { id: PageTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    ...getDataTabs(entity, tab === "overview" ? undefined : tab),
  ];

  return (
    <>
      <SegmentedControl tabs={tabs} activeTab={tab} onTabChange={onTabChange} className="px-4" />
      <View className={tab === "overview" ? "flex-1" : "hidden"}>{children}</View>
      {tab !== "overview" && (
        <ScrollShadow size="sm" className="flex-1">
          <ScrollView className="flex-1">
            <DataTabContent tab={tab} entity={entity} sharedTimestamp={null} />
          </ScrollView>
        </ScrollShadow>
      )}
    </>
  );
}
