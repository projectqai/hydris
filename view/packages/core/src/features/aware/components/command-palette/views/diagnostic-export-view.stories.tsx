import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { expect, fn, mocked, screen, userEvent, waitFor } from "storybook/test";

import { downloadFromEndpoint } from "../../../../../lib/download";
import { paletteView } from "../../../../../storybook/palette-view";
import { downloadNeverFinishes } from "../../../../../storybook/requests";
import { DiagnosticExportView } from "./diagnostic-export-view";

const meta = {
  title: "Core/Aware/Command palette/Views/DiagnosticExportView",
  component: DiagnosticExportView,
  args: { onClose: fn() },
  decorators: [paletteView()],
} satisfies Meta<typeof DiagnosticExportView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Engine logs")).toBeVisible();
    await expect(
      canvas.getByPlaceholderText("e.g. map tiles not loading after restart"),
    ).toBeVisible();
  },
};

export const ExportFails: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.type(
      canvas.getByPlaceholderText("e.g. map tiles not loading after restart"),
      "Tiles missing after restart",
    );
    await userEvent.click(canvas.getByText("Export diagnostic"));
    await expect(
      await screen.findByText("downloadFromEndpoint called from a story"),
    ).toBeInTheDocument();
    await expect(downloadFromEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "http://storybook.invalid/diagnostic/export",
        body: JSON.stringify({ user_note: "Tiles missing after restart" }),
      }),
    );
    await waitFor(() => expect(canvas.getByText("Export diagnostic")).toBeVisible());
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

export const Exports: Story = {
  beforeEach: () => {
    mocked(downloadFromEndpoint).mockResolvedValue();
  },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Export diagnostic"));
    await expect(await screen.findByText("Sent to downloads")).toBeInTheDocument();
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const Exporting: Story = {
  parameters: { a11y: { test: "todo" } },
  beforeEach: downloadNeverFinishes,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Export diagnostic"));
    await expect(await canvas.findByText("Exporting…")).toBeVisible();
  },
};
