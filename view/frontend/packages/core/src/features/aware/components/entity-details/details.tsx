import { Badge } from "@hydris/ui/badge";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { MiddleTruncateText } from "@hydris/ui/middle-truncate-text";
import { Tab, Tabs } from "@hydris/ui/tabs";
import type { Entity } from "@projectqai/proto/world";
import * as Clipboard from "expo-clipboard";
import { Copy, Eye, Info, MapPin, SquareStack } from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { toast } from "sonner-native";

import {
  getEntityName,
  getStatusBadgeVariant,
  getTrackStatus,
  type TrackStatus,
} from "../../../../lib/api/use-track-utils";
import { useUrlParams } from "../../../../lib/use-url-params";
import { useTabStore } from "../../store/tab-store";
import { ComponentsTab } from "./components-tab";
import { InfoTab } from "./info-tab";
import { LocationTab } from "./location-tab";
import { OverviewTab } from "./overview-tab";

type EntityDetailsContextValue = {
  entity: Entity;
  entityName: string;
  status: TrackStatus;
};

const EntityDetailsContext = createContext<EntityDetailsContextValue | null>(null);

function useEntityDetails() {
  const context = useContext(EntityDetailsContext);
  if (!context) throw new Error("EntityDetails components must be used within EntityDetails.Root");
  return context;
}

function Root({ entity, children }: { entity: Entity; children: ReactNode }) {
  const status = getTrackStatus(entity);
  const entityName = getEntityName(entity);

  return (
    <EntityDetailsContext.Provider value={{ entity, entityName, status }}>
      <View className="flex-1 select-none">{children}</View>
    </EntityDetailsContext.Provider>
  );
}

function Header({ children }: { children?: ReactNode }) {
  const t = useThemeColors();
  const { entity, entityName, status } = useEntityDetails();

  const copyToClipboard = async (text: string) => {
    await Clipboard.setStringAsync(text);
    toast("Copied to clipboard");
  };

  return (
    <View
      // @ts-expect-error dataSet is a React Native Web prop
      dataSet={process.env.EXPO_OS === "web" ? { detailHeader: "" } : undefined}
      className="border-foreground/5 border-b px-3 pt-2 pb-2.5"
    >
      <View className="flex-row items-center justify-between gap-2">
        <View className="min-w-0 flex-1">
          <MiddleTruncateText
            text={entityName}
            className="font-sans-semibold text-foreground text-15"
          />
        </View>
        {status && (
          <View className="shrink-0">
            <Badge variant={getStatusBadgeVariant(status)} size="sm">
              {status}
            </Badge>
          </View>
        )}
      </View>

      <Pressable
        onPress={() => copyToClipboard(entity.id)}
        className="mt-3 mb-2.5 flex-row items-center gap-1.5 active:opacity-70"
        hitSlop={8}
        accessibilityLabel="Copy entity ID"
        accessibilityRole="button"
      >
        <View className="min-w-0 flex-1">
          <MiddleTruncateText text={entity.id} className="text-foreground/75 font-mono text-xs" />
        </View>
        <Copy size={12} color={t.iconMuted} strokeWidth={2} />
      </Pressable>

      {children}
    </View>
  );
}

function DetailTabs() {
  const { entity } = useEntityDetails();
  const { params } = useUrlParams();
  const storedTab = useTabStore((s) => s.initialTab);
  const clearInitialTab = useTabStore((s) => s.clearInitialTab);

  const hasLocationTab = !!(entity.bearing || entity.geo?.covariance);
  const hasInfoTab = !!(entity.symbol || entity.lifetime);
  const availableTabs = [
    "overview",
    ...(hasLocationTab ? ["location"] : []),
    ...(hasInfoTab ? ["info"] : []),
    "components",
  ];

  const initialTab = params.tab ?? storedTab ?? "overview";
  const [activeTab, setActiveTab] = useState(() => {
    useTabStore.setState({ activeDetailTab: initialTab });
    return initialTab;
  });

  useEffect(() => {
    if (storedTab) clearInitialTab();
  }, [storedTab, clearInitialTab]);

  useEffect(() => {
    if (params.tab && !availableTabs.includes(params.tab)) {
      toast.error(`Tab "${params.tab}" not available for this entity`);
    }
  }, [params.tab, availableTabs]);

  const handleTabChange = (tabName: string) => {
    setActiveTab(tabName);
    useTabStore.setState({ activeDetailTab: tabName });
  };

  return (
    <Tabs currentTab={activeTab} onTabChange={handleTabChange} disableHover>
      <Tab name="overview" title="Overview" subtitle="Overview" icon={Eye}>
        <OverviewTab entity={entity} />
      </Tab>
      {hasLocationTab && (
        <Tab name="location" title="Location" subtitle="Location" icon={MapPin}>
          <LocationTab entity={entity} />
        </Tab>
      )}
      {hasInfoTab && (
        <Tab name="info" title="Info" subtitle="Info" icon={Info}>
          <InfoTab entity={entity} />
        </Tab>
      )}
      <Tab name="components" title="Components" subtitle="Components" icon={SquareStack}>
        <ComponentsTab entity={entity} />
      </Tab>
    </Tabs>
  );
}

export { useEntityDetails };

export const EntityDetails = {
  Root,
  Header,
  Tabs: DetailTabs,
};
