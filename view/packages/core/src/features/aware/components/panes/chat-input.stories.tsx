import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, fn, mocked, userEvent, waitFor } from "storybook/test";

import { useSendChat } from "../../../../lib/api/use-chat";
import { chatMessage, STORY_SELF_ID } from "../../../../storybook/chat";
import { seedChat, seedEntities } from "../../../../storybook/seed";
import { ChatInput } from "./chat-pane";

function sent() {
  return mocked(useSendChat).mock.results[0]?.value;
}

type Args = NonNullable<Parameters<typeof ChatInput>[0]>;

const question = chatMessage("m1", "alpha-2", "Can you confirm the contact at grid 4471?", 120);

const meta = {
  title: "Core/Aware/Panes/ChatInput",
  component: ChatInput,
  tags: ["!autodocs"],
  args: { onSend: fn() },
  beforeEach: () => seedEntities([], { isConnected: true }),
  decorators: [
    (Story) => (
      <View className="w-96">
        <Story />
      </View>
    ),
  ],
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<Args>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Message...")).not.toHaveAttribute("readonly");
    await expect(canvas.getByLabelText("Send message")).not.toHaveAttribute("aria-disabled");
  },
};

export const Connecting: Story = {
  beforeEach: () => seedEntities([], { isConnected: false }),
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Connecting...")).toHaveAttribute("readonly");
    await expect(canvas.getByLabelText("Send message")).toHaveAttribute("aria-disabled", "true");
  },
};

export const ConnectionLost: Story = {
  beforeEach: () => seedEntities([], { isConnected: false, error: new Error("Stream closed") }),
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Connection lost")).toHaveAttribute("readonly");
  },
};

export const SendsWithEnter: Story = {
  play: async ({ args, canvas }) => {
    const field = canvas.getByPlaceholderText("Message...");

    await userEvent.type(field, "Moving to checkpoint{Enter}");
    await expect(sent().sendMessage).toHaveBeenCalledOnce();
    await expect(sent().sendMessage).toHaveBeenCalledWith("Moving to checkpoint");
    await expect(args.onSend).toHaveBeenCalledOnce();
    await expect(field).toHaveValue("");
  },
};

export const SendsWithButton: Story = {
  play: async ({ args, canvas }) => {
    const field = canvas.getByPlaceholderText("Message...");

    await userEvent.type(field, "Moving to checkpoint");
    await userEvent.click(canvas.getByLabelText("Send message"));
    await expect(sent().sendMessage).toHaveBeenCalledOnce();
    await expect(sent().sendMessage).toHaveBeenCalledWith("Moving to checkpoint");
    await expect(args.onSend).toHaveBeenCalledOnce();
    await expect(field).toHaveValue("");
  },
};

export const IgnoresBlankMessage: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.type(canvas.getByPlaceholderText("Message..."), "   {Enter}");
    await expect(sent().sendMessage).not.toHaveBeenCalled();
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

export const Replying: Story = {
  beforeEach: () => seedChat([question], { replyTo: question }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("alpha-2")).toBeVisible();
    await expect(canvas.getByText("Can you confirm the contact at grid 4471?")).toBeVisible();
  },
};

export const ReplyingToSelf: Story = {
  beforeEach: () => {
    const own = chatMessage("m2", STORY_SELF_ID, "Holding at the bridge", 90);

    seedChat([own], { replyTo: own });
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("You")).toBeVisible();
  },
};

export const SendsReply: Story = {
  beforeEach: () => seedChat([question], { replyTo: question }),
  play: async ({ args, canvas }) => {
    await userEvent.type(canvas.getByPlaceholderText("Message..."), "Confirmed{Enter}");
    await expect(sent().sendReply).toHaveBeenCalledOnce();
    await expect(sent().sendReply).toHaveBeenCalledWith("Confirmed", "m1");
    await expect(sent().sendMessage).not.toHaveBeenCalled();
    await expect(args.onSend).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(canvas.queryByText("Can you confirm the contact at grid 4471?")).toBeNull(),
    );
  },
};

export const HoversCancelReply: Story = {
  beforeEach: () => seedChat([question], { replyTo: question }),
  play: async ({ canvas }) => {
    await userEvent.hover(canvas.getByLabelText("Cancel reply"));
  },
};

export const SendPending: Story = {
  beforeEach: () => {
    mocked(useSendChat).mockReturnValue({
      sendMessage: fn().mockName("sendMessage"),
      sendReply: fn().mockName("sendReply"),
      isPending: true,
      error: null,
    });
  },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByLabelText("Send message")).toHaveAttribute("aria-disabled", "true");

    await userEvent.type(canvas.getByPlaceholderText("Message..."), "Moving to checkpoint{Enter}");
    await expect(sent().sendMessage).not.toHaveBeenCalled();
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

export const CancelsReply: Story = {
  beforeEach: () => seedChat([question], { replyTo: question }),
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Cancel reply"));
    await waitFor(() => expect(canvas.queryByText("alpha-2")).toBeNull());
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

export const Borderless: Story = {
  args: { borderless: true },
};

export const NonInteractive: Story = {
  args: { interactive: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText("Message...")).toHaveAttribute("readonly");
  },
};
