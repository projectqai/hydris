import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { getEntityIcon } from "../utils/entity-helpers";

const ICON_WELL_CLASS =
  "bg-glass border-surface-overlay/4 size-10 items-center justify-center rounded-lg border";

type PageHeaderProps = {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  timestamp?: string;
  status?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  timestamp,
  status,
  className,
  children,
}: PageHeaderProps) {
  const t = useThemeColors();
  const showsTitle = title !== subtitle;

  return (
    <View className={cn("flex-row items-center gap-3 px-4 py-3", className)}>
      <View className={ICON_WELL_CLASS}>
        <Icon aria-hidden size={18} strokeWidth={2} color={t.iconDefault} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        {showsTitle || status ? (
          <View className="flex-row items-center gap-2">
            {showsTitle && (
              <Text className="font-sans-semibold text-foreground shrink text-base">{title}</Text>
            )}
            {status}
          </View>
        ) : null}
        <View className="flex-row items-center gap-1.5">
          <Text className="text-muted-foreground shrink font-mono text-xs">{subtitle}</Text>
          {timestamp && (
            <>
              <Text className="text-muted-foreground shrink-0 font-mono text-xs">·</Text>
              <Text className="text-muted-foreground shrink-0 font-mono text-xs" numberOfLines={1}>
                {timestamp}
              </Text>
            </>
          )}
        </View>
      </View>
      {children}
    </View>
  );
}

export function EntityHeader({
  entity,
  subtitle = entity.id,
  ...props
}: { entity: Entity; subtitle?: string } & Omit<PageHeaderProps, "icon" | "subtitle">) {
  return <PageHeader icon={getEntityIcon(entity)} subtitle={subtitle} {...props} />;
}
