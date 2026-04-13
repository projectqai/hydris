import { GradientPanel, useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { FloatingSheet, type SheetOption } from "@hydris/ui/sheets/floating-sheet";
import { TimeWidget } from "@hydris/ui/widgets/time-widget";
import { Image } from "expo-image";
import { type Href, usePathname, useRootNavigationState, useRouter } from "expo-router";
import { Bell, Box, Menu, Wifi, WifiOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEntityStore } from "../features/aware/store/entity-store";

type TopNavContextValue = {
  pathname: string | null;
  isActive: (path: string) => boolean;
};

const TopNavContext = createContext<TopNavContextValue | null>(null);

function useTopNav() {
  const context = useContext(TopNavContext);
  if (!context) throw new Error("TopNav components must be used within TopNav.Root");
  return context;
}

function Root({ children }: { children: ReactNode }) {
  const navigationState = useRootNavigationState();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (!navigationState?.key) return null;

  const isActive = (path: string): boolean => {
    if (!pathname) return false;
    if (path === "/") return pathname === "/";
    return pathname.startsWith(path);
  };

  return (
    <TopNavContext.Provider value={{ pathname, isActive }}>
      <View style={{ paddingTop: insets.top }}>
        <GradientPanel className="h-8 flex-row items-center justify-between px-2 select-none lg:h-11 lg:px-4">
          {children}
        </GradientPanel>
        <View className="bg-surface-overlay/5 h-px" />
      </View>
    </TopNavContext.Provider>
  );
}

function Left({ children }: { children: ReactNode }) {
  return <View className="flex-row items-center gap-3 lg:gap-4">{children}</View>;
}

function Right({ children }: { children: ReactNode }) {
  return <View className="flex-row items-center gap-1 lg:gap-1.5">{children}</View>;
}

function Logo() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/")}
      accessibilityLabel="Home"
      accessibilityRole="link"
      className="focus:outline-none"
    >
      <Image
        source={require("@hydris/ui/assets/logo.png")}
        className="size-5 opacity-80 lg:size-6"
        contentFit="contain"
        cachePolicy="memory-disk"
        accessible={false}
      />
    </Pressable>
  );
}

function LogoOrTime() {
  const { isActive } = useTopNav();
  return isActive("/aware") ? <TimeWidget /> : <Logo />;
}

type Section = {
  label: string;
  path: string;
};

function Sections({ items }: { items: Section[] }) {
  const router = useRouter();
  const { isActive } = useTopNav();

  return (
    <View className="bg-surface-overlay/4 pointer-events-auto h-6 flex-row items-center rounded-lg p-0.5 lg:h-8 lg:p-1">
      {items.map((section) => {
        const active = isActive(section.path);
        return (
          <Pressable
            key={section.path}
            onPress={() => router.push(section.path as Href)}
            className={cn(
              "h-full items-center justify-center rounded-md px-2.5 transition-colors focus:outline-none lg:h-full lg:px-5",
              active ? "bg-surface-overlay/10" : "active:bg-surface-overlay/10",
            )}
          >
            <Text
              className={cn(
                "font-sans-medium text-10 lg:text-13 tracking-wide transition-colors",
                active ? "text-foreground" : "text-foreground/75",
              )}
            >
              {section.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Workspace({ name = "Default" }: { name?: string }) {
  const t = useThemeColors();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push("/")}
      className="bg-glass hover:bg-glass-hover active:bg-glass-active flex h-7 flex-row items-center gap-2 rounded-md px-2 focus:outline-none lg:h-9 lg:gap-2.5 lg:px-3"
    >
      <View className="bg-accent size-5 items-center justify-center rounded lg:size-6">
        <Box size={12} strokeWidth={1.5} className="lg:hidden" color={t.iconActive} />
        <Box size={14} strokeWidth={1.5} className="hidden lg:flex" color={t.iconActive} />
      </View>
      <View className="gap-px">
        <Text className="text-foreground/75 text-8 lg:text-9 font-sans leading-none tracking-wider uppercase">
          Workspace
        </Text>
        <Text className="font-sans-semibold text-foreground/80 text-9 lg:text-11 leading-none">
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

function QuickActions({
  options,
  onSelect,
}: {
  options: SheetOption[];
  onSelect: (id: string) => void;
}) {
  const t = useThemeColors();
  const [visible, setVisible] = useState(false);

  const handleSelect = (id: string) => {
    onSelect(id);
    setVisible(false);
  };

  return (
    <>
      <Pressable
        className="bg-glass hover:bg-glass-hover active:bg-glass-active flex size-7 items-center justify-center rounded-md focus:outline-none lg:size-9"
        onPress={() => setVisible(true)}
        accessibilityLabel="Quick actions menu"
        accessibilityRole="button"
      >
        <Menu size={16} strokeWidth={1.5} className="lg:hidden" color={t.iconMuted} />
        <Menu size={18} strokeWidth={1.5} className="hidden lg:flex" color={t.iconMuted} />
      </Pressable>
      <FloatingSheet
        visible={visible}
        onClose={() => setVisible(false)}
        onSelect={handleSelect}
        options={options}
      />
    </>
  );
}

function Alerts({ count = 0 }: { count?: number }) {
  const t = useThemeColors();
  return (
    <Pressable
      className="bg-glass hover:bg-glass-hover active:bg-glass-active relative flex size-7 items-center justify-center rounded-md focus:outline-none lg:size-9"
      accessibilityLabel={count > 0 ? `${count} alerts` : "Alerts"}
      accessibilityRole="button"
    >
      <Bell size={16} strokeWidth={1.5} className="lg:hidden" color={t.iconMuted} />
      <Bell size={18} strokeWidth={1.5} className="hidden lg:flex" color={t.iconMuted} />
      {count > 0 && (
        <View className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-red-500 lg:top-1 lg:right-1" />
      )}
    </Pressable>
  );
}

function ConnectionStatus() {
  const t = useThemeColors();
  const isConnected = useEntityStore((s) => s.isConnected);
  const error = useEntityStore((s) => s.error);
  const [showTooltip, setShowTooltip] = useState(false);

  const isDisconnected = !!error;
  const iconColor = isDisconnected
    ? "rgb(239, 68, 68)"
    : isConnected
      ? t.activeGreen
      : "rgb(251, 191, 36)";

  const tooltipText = isDisconnected ? "Disconnected" : isConnected ? "Connected" : "Connecting...";

  return (
    <View className="relative">
      <Pressable
        onHoverIn={() => setShowTooltip(true)}
        onHoverOut={() => setShowTooltip(false)}
        className="bg-glass hover:bg-glass-hover active:bg-glass-active flex size-7 items-center justify-center rounded-md focus:outline-none lg:size-9"
        accessibilityLabel={tooltipText}
        accessibilityRole="button"
      >
        {isDisconnected ? (
          <>
            <WifiOff size={16} strokeWidth={1.5} className="lg:hidden" color={iconColor} />
            <WifiOff size={18} strokeWidth={1.5} className="hidden lg:flex" color={iconColor} />
          </>
        ) : (
          <>
            <Wifi size={16} strokeWidth={1.5} className="lg:hidden" color={iconColor} />
            <Wifi size={18} strokeWidth={1.5} className="hidden lg:flex" color={iconColor} />
          </>
        )}
      </Pressable>
      {showTooltip && (
        <View className="absolute top-1/2 right-full z-50 mr-2 -translate-y-1/2 rounded border border-white/8 bg-black/92 px-2 py-1">
          <Text className="text-11 font-sans whitespace-nowrap text-white/88">{tooltipText}</Text>
        </View>
      )}
    </View>
  );
}

function IconButton({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className="bg-glass hover:bg-glass-hover active:bg-glass-active flex size-7 items-center justify-center rounded-md focus:outline-none lg:size-9"
    >
      {children}
    </Pressable>
  );
}

export const TopNav = {
  Root,
  Left,
  Right,
  LogoOrTime,
  Sections,
  Workspace,
  QuickActions,
  Alerts,
  ConnectionStatus,
  IconButton,
};
