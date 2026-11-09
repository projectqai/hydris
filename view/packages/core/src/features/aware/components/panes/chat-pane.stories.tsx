import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { View } from "react-native";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { chatMessage, STORY_SELF_ID } from "../../../../storybook/chat";
import { seedChat, seedEntities } from "../../../../storybook/seed";
import { ChatPane } from "./chat-pane";

const conversation = [
  chatMessage("m1", "alpha-2", "Contact moving north along the river", 600),
  chatMessage("m2", "alpha-2", "Two vehicles, one dismounted", 540),
  chatMessage("m3", STORY_SELF_ID, "Copy, tracking both", 300),
  chatMessage("m4", "bravo-1", "Confirm grid?", 240, { replyTo: "m3" }),
  chatMessage(
    "m5",
    STORY_SELF_ID,
    "Grid 4471 0932, heading 010, speed roughly 20 km/h, last seen passing the old mill on the east bank",
    120,
  ),
];

function bubble(text: HTMLElement) {
  const element = text.parentElement;

  if (!element) throw new Error("ChatPane markup changed");

  return element;
}

const meta = {
  title: "Core/Aware/Panes/ChatPane",
  component: ChatPane,
  tags: ["!autodocs"],
  beforeEach: () => seedEntities([], { isConnected: true }),
  decorators: [
    (Story) => (
      <View className="native:flex-1 h-[480px] w-96">
        <Story />
      </View>
    ),
  ],
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<typeof ChatPane>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () => seedChat(conversation),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Two vehicles, one dismounted")).toBeVisible();
    await expect(canvas.getAllByText("alpha-2")).toHaveLength(1);
    await expect(canvas.getAllByText("You")).toHaveLength(3);
    await expect(
      within(bubble(canvas.getByText("Confirm grid?"))).getByText("Copy, tracking both"),
    ).toBeVisible();
  },
};

export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No messages yet")).toBeVisible();
    await expect(canvas.getByPlaceholderText("Message...")).toBeVisible();
  },
};

export const StartsReply: Story = {
  beforeEach: () => seedChat(conversation),
  play: async ({ canvas }) => {
    const message = bubble(await canvas.findByText("Confirm grid?"));

    await userEvent.click(within(message).getByLabelText("Reply"));
    await waitFor(() => expect(canvas.getByLabelText("Cancel reply")).toBeVisible());
    await expect(canvas.getAllByText("Confirm grid?")).toHaveLength(2);
  },
};
