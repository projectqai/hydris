import { ControlIconButton } from "@hydris/ui/controls";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { format } from "date-fns";
import { MessageSquare, Reply, SendHorizontal, X } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { FlatList, Platform, Pressable, Text, TextInput, View } from "react-native";
import Animated, { interpolate, useAnimatedStyle } from "react-native-reanimated";

import { getSelfLabel, isSelfMessage, useSendChat } from "../../../../lib/api/use-chat";
import type { ChatMessage } from "../../store/chat-store";
import { useChatStore } from "../../store/chat-store";
import { useEntityStore } from "../../store/entity-store";
import { useSelectionStore } from "../../store/selection-store";
import { senderColor } from "../../utils/sender-color";
import { chatFocusProgress, floatingTextInputRef } from "./chat-input-shared";

const IS_NATIVE = Platform.OS !== "web";

const LIST_CONTENT_STYLE = { paddingTop: 6, paddingBottom: 6 } as const;
const keyExtractor = (item: ChatMessage) => item.id;

type ChatContextValue = {
  scrollToMessage: (id: string) => void;
  flashingId: string | null;
};

const ChatContext = createContext<ChatContextValue>({
  scrollToMessage: () => {},
  flashingId: null,
});

function MessageRow({
  item,
  replyTarget,
  isGrouped,
}: {
  item: ChatMessage;
  replyTarget: ChatMessage | undefined;
  isGrouped: boolean;
}) {
  const isSelf = isSelfMessage(item.senderId, item.id);
  const { colorScheme } = useColorScheme();
  const t = useThemeColors();
  const select = useSelectionStore((s) => s.select);
  const entities = useEntityStore((s) => s.entities);
  const fetchEntity = useEntityStore((s) => s.fetchEntity);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const { scrollToMessage, flashingId } = useContext(ChatContext);
  const time = format(item.timestamp, "HH:mm");
  const senderName = isSelf ? (getSelfLabel() ?? "You") : item.senderName;
  const showHeader = !isGrouped || !!replyTarget;
  const isDark = colorScheme !== "light";
  const nameColor = isSelf
    ? isDark
      ? "rgb(147, 197, 253)"
      : "rgb(30, 58, 138)"
    : senderColor(item.senderName, isDark);
  const isFlashing = flashingId === item.id;

  const handleSenderPress = () => {
    if (!item.senderId) return;
    if (!entities.has(item.senderId)) {
      fetchEntity(item.senderId);
    }
    select(item.senderId);
  };

  return (
    <View className={cn("px-3 pb-1", isSelf ? "items-end" : "items-start")}>
      <View
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2",
          isFlashing
            ? "bg-foreground/20"
            : isSelf
              ? "bg-blue/25 dark:bg-foreground/15"
              : "bg-glass",
        )}
      >
        {showHeader && (
          <Pressable onPress={handleSenderPress} hitSlop={8} disabled={!item.senderId}>
            <Text
              className="font-sans-semibold text-13"
              numberOfLines={1}
              style={{ color: nameColor }}
            >
              {senderName}
            </Text>
          </Pressable>
        )}
        {replyTarget && (
          <Pressable
            onPress={() => scrollToMessage(item.replyTo!)}
            className="bg-foreground/7 my-1 rounded border-l-2 px-2.5 py-1.5"
            style={{
              borderLeftColor: isSelfMessage(replyTarget.senderId, replyTarget.id)
                ? nameColor
                : senderColor(replyTarget.senderName, isDark),
            }}
          >
            <Text
              className="font-sans-semibold text-13"
              numberOfLines={1}
              style={{
                color: isSelfMessage(replyTarget.senderId, replyTarget.id)
                  ? nameColor
                  : senderColor(replyTarget.senderName, isDark),
              }}
            >
              {isSelfMessage(replyTarget.senderId, replyTarget.id)
                ? (getSelfLabel() ?? "You")
                : replyTarget.senderName}
            </Text>
            <Text className="text-foreground/75 font-sans text-xs" numberOfLines={1}>
              {replyTarget.text}
            </Text>
          </Pressable>
        )}
        <Text className="text-foreground mt-0.5 font-sans text-sm leading-5">{item.text}</Text>
        <View className="flex-row items-center justify-end gap-1.5">
          <Text
            className="text-muted-foreground font-mono text-xs"
            style={{ fontVariant: ["tabular-nums"] }}
          >
            {time}
          </Text>
          <Pressable
            onPress={() => setReplyTo(item)}
            hitSlop={12}
            accessibilityLabel="Reply"
            className="hover:bg-foreground/10 active:bg-foreground/15 shrink-0 rounded p-1"
          >
            <Reply size={14} strokeWidth={2} color={t.iconMuted} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export function ReplyBanner() {
  const t = useThemeColors();
  const { colorScheme } = useColorScheme();
  const replyTo = useChatStore((s) => s.replyTo);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const [dismissHovered, setDismissHovered] = useState(false);

  if (!replyTo) return null;

  const isSelf = isSelfMessage(replyTo.senderId, replyTo.id);
  const senderName = isSelf ? (getSelfLabel() ?? "You") : replyTo.senderName;
  const nameColor = senderColor(replyTo.senderName, colorScheme !== "light");

  return (
    <View className="border-surface-overlay/8 flex-row items-center gap-2.5 border-t px-3 py-2">
      <View className="shrink-0">
        <Reply size={14} strokeWidth={2} color={t.iconMuted} />
      </View>
      <View className="shrink">
        <Text className="font-sans-semibold text-13" numberOfLines={1} style={{ color: nameColor }}>
          {senderName}
        </Text>
        <Text className="text-muted-foreground font-sans text-xs" numberOfLines={1}>
          {replyTo.text}
        </Text>
      </View>
      <Pressable
        onPress={() => setReplyTo(null)}
        onHoverIn={() => setDismissHovered(true)}
        onHoverOut={() => setDismissHovered(false)}
        hitSlop={12}
        accessibilityLabel="Cancel reply"
        className="hover:bg-destructive/15 active:bg-destructive/25 ml-auto shrink-0 rounded p-1"
      >
        <X size={14} strokeWidth={1.5} color={dismissHovered ? t.destructiveRed : t.iconMuted} />
      </Pressable>
    </View>
  );
}

export function ChatInput({
  onSend,
  textInputRef,
  interactive = true,
  borderless = false,
}: {
  onSend?: () => void;
  textInputRef?: React.RefObject<TextInput | null>;
  interactive?: boolean;
  borderless?: boolean;
} = {}) {
  const t = useThemeColors();
  const { sendMessage, sendReply, isPending } = useSendChat();
  const isConnected = useEntityStore((s) => s.isConnected);
  const hasError = useEntityStore((s) => s.error !== null);
  const replyTo = useChatStore((s) => s.replyTo);
  const setReplyTo = useChatStore((s) => s.setReplyTo);
  const pinToBottom = useChatStore((s) => s.pinToBottom);
  const internalRef = useRef<TextInput>(null);
  const inputRef = textInputRef ?? internalRef;
  const textRef = useRef("");
  const disabled = !isConnected || isPending;

  const handleSend = () => {
    const text = textRef.current;
    if (!text.trim() || disabled) return;
    textRef.current = "";
    inputRef.current?.clear();
    if (replyTo) {
      sendReply(text, replyTo.id);
      setReplyTo(null);
    } else {
      sendMessage(text);
    }
    pinToBottom();
    onSend?.();
  };

  return (
    <View>
      <ReplyBanner />
      <View
        className={cn(
          "flex-row items-center gap-2.5 px-3 py-2.5",
          !borderless && "border-surface-overlay/8 border-t",
        )}
      >
        <View className="border-control-border bg-control-input flex-1 overflow-hidden rounded-lg border">
          <TextInput
            ref={inputRef}
            placeholder={
              isConnected ? "Message..." : hasError ? "Connection lost" : "Connecting..."
            }
            placeholderTextColor={t.placeholder}
            editable={interactive && isConnected}
            onChangeText={(text) => {
              textRef.current = text;
            }}
            onSubmitEditing={handleSend}
            blurOnSubmit={Platform.OS !== "web"}
            autoCapitalize="none"
            autoCorrect={false}
            disableFullscreenUI
            className="text-foreground px-3 py-2.5 font-sans text-sm"
            // @ts-expect-error outlineStyle is a React Native Web prop
            style={{ outlineStyle: "none", backgroundColor: "transparent" }}
          />
        </View>
        <ControlIconButton
          icon={SendHorizontal}
          iconSize={16}
          iconStrokeWidth={1.5}
          onPress={handleSend}
          disabled={disabled}
          accessibilityLabel="Send message"
          size="lg"
        />
      </View>
    </View>
  );
}

export function ChatPane() {
  const t = useThemeColors();
  const sortedMessages = useChatStore((s) => s.sortedMessages);
  const messages = useChatStore((s) => s.messages);
  const markRead = useChatStore((s) => s.markRead);
  const registerPinToBottom = useChatStore((s) => s.registerPinToBottom);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const isNearBottomRef = useRef(true);
  const [flashingId, setFlashingId] = useState<string | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Inverted list: newest message at index 0 (rendered at bottom)
  const reversedMessages = [...sortedMessages].reverse();

  useEffect(() => {
    registerPinToBottom(() => {
      isNearBottomRef.current = true;
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return () => registerPinToBottom(null);
  }, [registerPinToBottom]);

  useEffect(() => {
    markRead();
  }, [sortedMessages.length, markRead]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, []);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset } = e.nativeEvent;
    isNearBottomRef.current = contentOffset.y <= 80;
  };

  const scrollToMessage = (id: string) => {
    const index = reversedMessages.findIndex((m) => m.id === id);
    if (index === -1) return;
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      setFlashingId(id);
      flashTimeoutRef.current = setTimeout(() => setFlashingId(null), 1800);
    }, 400);
  };

  return (
    <ChatContext value={{ scrollToMessage, flashingId }}>
      <View className="flex-1">
        {sortedMessages.length === 0 ? (
          <View className="flex-1 items-center justify-center gap-3 px-6">
            <MessageSquare size={28} strokeWidth={1} color={t.iconMuted} />
            <Text className="text-muted-foreground font-sans text-sm">No messages yet</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={reversedMessages}
            keyExtractor={keyExtractor}
            renderItem={({ item, index }) => {
              const above = reversedMessages[index + 1];
              const isGrouped =
                !!above &&
                above.senderName === item.senderName &&
                isSelfMessage(above.senderId, above.id) === isSelfMessage(item.senderId, item.id);
              return (
                <MessageRow
                  item={item}
                  replyTarget={item.replyTo ? messages.get(item.replyTo) : undefined}
                  isGrouped={isGrouped}
                />
              );
            }}
            contentContainerStyle={LIST_CONTENT_STYLE}
            onScroll={handleScroll}
            scrollEventThrottle={100}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: true,
              });
            }}
          />
        )}
        {IS_NATIVE ? <NativeChatInput /> : <ChatInput />}
      </View>
    </ChatContext>
  );
}

function NativeChatInput() {
  const containerRef = useRef<View>(null);
  const setInputSlot = useChatStore((s) => s.setInputSlot);

  const handleLayout = useCallback(() => {
    containerRef.current?.measureInWindow((x, y, width, height) => {
      setInputSlot({ pageX: x, pageY: y, width, height });
    });
  }, [setInputSlot]);

  useEffect(() => () => setInputSlot(null), [setInputSlot]);

  const rStyle = useAnimatedStyle(() => {
    const progress = chatFocusProgress.get();
    return {
      opacity: interpolate(progress, [0, 0.15], [1, 0], "clamp"),
    };
  });

  const handlePress = useCallback(() => {
    const input = floatingTextInputRef.current;
    if (!input) return;
    input.blur();
    input.focus();
  }, []);

  return (
    <Animated.View ref={containerRef} onLayout={handleLayout} style={rStyle}>
      <Pressable onPress={handlePress} accessibilityLabel="Open chat input">
        <ChatInput interactive={false} />
      </Pressable>
    </Animated.View>
  );
}
