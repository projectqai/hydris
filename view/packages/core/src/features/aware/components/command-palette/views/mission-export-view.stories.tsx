import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, mocked, screen, userEvent, waitFor } from "storybook/test";

import { downloadFromEndpoint } from "../../../../../lib/download";
import { paletteView } from "../../../../../storybook/palette-view";
import { downloadNeverFinishes } from "../../../../../storybook/requests";
import { MissionExportView } from "./mission-export-view";

const meta = {
  title: "Core/Aware/Command palette/Views/MissionExportView",
  component: MissionExportView,
  args: { onClose: fn() },
  parameters: { a11y: { test: "todo" } },
  decorators: [paletteView()],
} satisfies Meta<typeof MissionExportView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Always")).toBeVisible();
    await expect(canvas.getByRole("switch", { name: "Media & files" })).toBeVisible();
  },
};

export const SendsChosenParts: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("switch", { name: "Access policy" }));
    await userEvent.click(canvas.getByText("Export mission pack"));
    await waitFor(() => expect(downloadFromEndpoint).toHaveBeenCalledOnce());
    await expect(downloadFromEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://storybook.invalid/mission/export",
        body: JSON.stringify({
          include_mission_kit: true,
          with_artifacts: true,
          with_policy: false,
        }),
      }),
    );
  },
};

export const PressingARowLabelToggles: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Rules for who can connect and make changes"));
    await expect(canvas.getByRole("switch", { name: "Access policy" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  },
};

export const ClosesAfterExport: Story = {
  beforeEach: () => {
    mocked(downloadFromEndpoint).mockResolvedValue();
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Export mission pack"));
    await waitFor(() => expect(args.onClose).toHaveBeenCalledOnce());
  },
};

export const Exporting: Story = {
  beforeEach: downloadNeverFinishes,
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Export mission pack"));
    await expect(await canvas.findByText("Exporting…")).toBeVisible();
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

export const ExportFails: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Export mission pack"));
    await expect(
      await screen.findByText("downloadFromEndpoint called from a story"),
    ).toBeInTheDocument();
    await waitFor(() => expect(canvas.getByText("Export mission pack")).toBeVisible());
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};
