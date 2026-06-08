import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { Alert, Modal, Platform, Pressable, Text, View } from "react-native";

import { ControlButton } from "../controls/control-button";
import { GRADIENT_PROPS, useThemeColors } from "../lib/theme";

export type ConfirmDialogProps = {
  readonly visible: boolean;
  readonly title: string;
  readonly message?: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useThemeColors();

  const handlersRef = useRef({ onConfirm, onCancel });
  handlersRef.current = { onConfirm, onCancel };

  const prevVisibleRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (!visible || wasVisible) return;
    Alert.alert(
      title,
      message,
      [
        {
          text: cancelLabel,
          style: "cancel",
          onPress: () => handlersRef.current.onCancel(),
        },
        {
          text: confirmLabel,
          style: destructive ? "destructive" : "default",
          onPress: () => handlersRef.current.onConfirm(),
        },
      ],
      { cancelable: true, onDismiss: () => handlersRef.current.onCancel() },
    );
  }, [visible, title, message, confirmLabel, cancelLabel, destructive]);

  if (Platform.OS !== "web") return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View accessibilityViewIsModal style={{ flex: 1 }}>
        <Pressable
          onPress={onCancel}
          accessibilityLabel={cancelLabel}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: t.backdrop,
          }}
        />

        <View
          accessibilityRole="alert"
          aria-label={title}
          style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}
          pointerEvents="box-none"
        >
          <View style={{ width: "100%", maxWidth: 420 }} onStartShouldSetResponder={() => true}>
            <LinearGradient
              colors={t.gradients.card}
              {...GRADIENT_PROPS}
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: t.borderSubtle,
                overflow: "hidden",
              }}
            >
              <View style={{ padding: 20, gap: 8 }}>
                <Text className="font-sans-semibold text-foreground text-base">{title}</Text>
                {message && (
                  <Text className="text-muted-foreground font-sans text-sm">{message}</Text>
                )}
              </View>

              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  padding: 12,
                  borderTopWidth: 1,
                  borderTopColor: t.borderSubtle,
                }}
              >
                <View style={{ flex: 1 }}>
                  <ControlButton
                    onPress={onCancel}
                    label={cancelLabel}
                    size="lg"
                    fullWidth
                    labelClassName="font-mono text-xs font-semibold uppercase"
                    accessibilityLabel={cancelLabel}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <ControlButton
                    onPress={onConfirm}
                    label={confirmLabel}
                    variant={destructive ? "destructive" : "active"}
                    size="lg"
                    fullWidth
                    labelClassName="font-mono text-xs font-semibold uppercase"
                    className="hover:opacity-90"
                    accessibilityLabel={confirmLabel}
                  />
                </View>
              </View>
            </LinearGradient>
          </View>
        </View>
      </View>
    </Modal>
  );
}
