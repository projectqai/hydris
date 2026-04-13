import { type LucideIcon } from "lucide-react-native";
import { type ReactElement, type ReactNode, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { useThemeColors } from "../lib/theme";
import { cn } from "../lib/utils";

type TabProps = {
  name: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  children: ReactNode;
};

type TabsProps = {
  children:
    | ReactElement<TabProps>
    | (ReactElement<TabProps> | false | null | undefined)[]
    | false
    | null
    | undefined;
  initialTab?: string;
  currentTab?: string;
  onTabChange?: (tabName: string) => void;
  disableHover?: boolean;
};

export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children, initialTab, currentTab, onTabChange, disableHover }: TabsProps) {
  const t = useThemeColors();
  const childrenArray = (Array.isArray(children) ? children : [children]).filter(
    (child): child is ReactElement<TabProps> => Boolean(child),
  );

  const tabs = childrenArray.map((child) => ({
    name: child.props.name,
    title: child.props.title,
    subtitle: child.props.subtitle,
    icon: child.props.icon,
  }));

  const [internalTab, setInternalTab] = useState(initialTab ?? tabs[0]?.name ?? "");
  const tabNames = tabs.map((t) => t.name);
  const resolvedTab = currentTab ?? internalTab;
  const activeTab = tabNames.includes(resolvedTab) ? resolvedTab : (tabs[0]?.name ?? "");
  const scrollRef = useRef<ScrollView>(null);
  const tabRefs = useRef<Record<string, View | null>>({});

  const handleTabPress = (tabName: string) => {
    if (!currentTab) {
      setInternalTab(tabName);
    }
    onTabChange?.(tabName);

    const tabView = tabRefs.current[tabName];
    if (tabView && scrollRef.current) {
      tabView.measureLayout(
        scrollRef.current as unknown as React.ElementRef<typeof View>,
        (x) => {
          scrollRef.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
        },
        () => {},
      );
    }
  };

  const activeChild = childrenArray.find((child) => child.props.name === activeTab);

  return (
    <View className="flex-1">
      <View className="border-border/50 border-b">
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="flex-grow px-1"
        >
          {tabs.map((tab) => {
            const isActive = tab.name === activeTab;
            const Icon = tab.icon;
            return (
              <Pressable
                key={tab.name}
                ref={(ref) => {
                  tabRefs.current[tab.name] = ref;
                }}
                onPress={() => handleTabPress(tab.name)}
                className={cn(
                  "relative flex-1 items-center rounded px-3 py-2",
                  !disableHover && "hover:bg-foreground/[0.06] active:bg-foreground/[0.10]",
                )}
              >
                {Icon ? (
                  <View className="items-center gap-1">
                    <Icon
                      size={18}
                      color={isActive ? t.iconStrong : t.iconDefault}
                      strokeWidth={isActive ? 2 : 1.5}
                    />
                    <Text
                      className={cn(
                        "text-xs",
                        isActive
                          ? "font-sans-medium text-foreground/80"
                          : "text-foreground/75 font-sans",
                      )}
                    >
                      {tab.subtitle ?? tab.title}
                    </Text>
                  </View>
                ) : (
                  <Text
                    className={cn(
                      "text-sm",
                      isActive
                        ? "font-sans-medium text-foreground/90"
                        : "text-foreground/75 font-sans",
                    )}
                  >
                    {tab.title}
                  </Text>
                )}
                {isActive && (
                  <View
                    className="absolute right-0 bottom-0 left-0 h-0.5"
                    style={{ backgroundColor: t.tabIndicator }}
                  />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View className="flex-1">{activeChild?.props.children}</View>
    </View>
  );
}
