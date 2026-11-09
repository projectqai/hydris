import { create } from "@bufbuild/protobuf";
import type { PathPoint } from "@hydris/map-engine/types";
import { drag, trackPoint } from "@hydris/ui/storybook/pointer";
import { GetLocalNodeResponseSchema } from "@projectqai/proto/world";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { setStringAsync } from "expo-clipboard";
import { View } from "react-native";
import { expect, fn, mocked, screen, userEvent, waitFor } from "storybook/test";

import { worldClient } from "../../../../lib/api/world-client";
import { decodeViewState } from "../../../../lib/use-url-params";
import { entity } from "../../../../storybook/entities";
import { coreProviders } from "../../../../storybook/providers";
import { acceptPushes } from "../../../../storybook/requests";
import { seed, seedEntities } from "../../../../storybook/seed";
import { useBullseyeStore } from "../../store/bullseye-store";
import { useEditStore } from "../../store/edit-store";
import { useMapStore } from "../../store/map-store";
import type { MapPath } from "../../store/path-store";
import { usePathStore } from "../../store/path-store";
import { useSelectionStore } from "../../store/selection-store";
import { MapControls } from "./map-controls";

const gate: PathPoint = { type: "coordinate", position: { lat: 52.5163, lng: 13.3777 } };
const tower: PathPoint = { type: "coordinate", position: { lat: 52.5208, lng: 13.4094 } };
const pier: PathPoint = { type: "coordinate", position: { lat: 52.4987, lng: 13.4461 } };

const movedTower = {
  entityId: "range-1",
  kind: "range" as const,
  points: [gate, tower],
  history: [{ points: [gate, pier] }],
};

const measuring: MapPath = { id: "1", kind: "range", points: [gate, tower] };

const roadClosures = entity("layer-roads", {
  label: "Road closures",
  mapLayer: {
    opacity: 0.6,
    source: { case: "tiles", value: { url: "https://tiles.example/roads/{z}/{x}/{y}.png" } },
  },
});

const offlineBerlin = entity("basemap-berlin", {
  label: "Berlin offline",
  mapLayer: { source: { case: "tiles", value: { url: "/tiles/berlin/{z}/{x}/{y}.png" } } },
});

function pushedLine() {
  const [change] = mocked(worldClient.push).mock.calls[0]?.[0].changes ?? [];
  const plane = change?.shape?.geometry?.planar?.plane;
  const line = plane?.case === "line" ? plane.value : undefined;

  return {
    id: change?.id,
    points: line?.points?.map((point) => [point.latitude, point.longitude]),
  };
}

const gateToTower = [
  [gate.position.lat, gate.position.lng],
  [tower.position.lat, tower.position.lng],
];

const meta = {
  title: "Core/Aware/Panes/MapControls",
  component: MapControls,
  tags: ["!autodocs"],
  args: {
    mapRef: {
      current: {
        zoomIn: fn(),
        zoomOut: fn(),
        flyTo: fn(),
        pushDelta: fn(),
        pushSelection: fn(),
        pushSettings: fn(),
        pushBullseye: fn(),
        pushPaths: fn(),
        pushHiddenLayers: fn(),
        pushLayerOpacity: fn(),
      },
    },
    viewRef: { current: { lat: 52.520008, lng: 13.404954, zoom: 11.26 } },
  },
  argTypes: { mapRef: { control: false } },
  decorators: [
    (Story) => (
      <View className="native:flex-1 relative h-[420px] w-80 bg-black/20">
        <Story />
      </View>
    ),
    coreProviders(),
  ],
  parameters: { a11y: { test: "todo" } },
} satisfies Meta<typeof MapControls>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const BaseLayerMenuOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Base layer"));

    await expect(await screen.findByRole("radio", { name: "Satellite" })).toBeChecked();
    await expect(screen.getByRole("radio", { name: "Street" })).not.toBeChecked();
    await expect(canvas.queryByText("Street")).toBeNull();
  },
};

export const SelectsBaseLayer: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Base layer"));
    await userEvent.click(await screen.findByText("Street"));
    await waitFor(() => expect(screen.queryByText("Street")).toBeNull());

    await userEvent.click(canvas.getByLabelText("Base layer"));
    await expect(await screen.findByRole("radio", { name: "Street" })).toBeChecked();
    await expect(screen.getByRole("radio", { name: "Satellite" })).not.toBeChecked();
  },
};

export const OfflineBasemapSelected: Story = {
  beforeEach: [
    () => seedEntities([offlineBerlin]),
    () => seed(useMapStore, { offlineBasemapId: "basemap-berlin" }),
  ],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Base layer"));

    await expect(await screen.findByRole("radio", { name: "Berlin offline" })).toBeChecked();
    await expect(screen.getByRole("radio", { name: "Satellite" })).not.toBeChecked();
  },
};

export const ClosesMenuOnEscape: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Base layer"));
    await screen.findByText("Street");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("Street")).toBeNull());
  },
};

export const ClosesMenuOnTriggerPress: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Base layer"));
    await screen.findByText("Street");

    await userEvent.click(canvas.getByLabelText("Base layer"));
    await waitFor(() => expect(screen.queryByText("Street")).toBeNull());
  },
};

export const ClosesMenuOnOutsidePress: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Share"));
    await screen.findByText("Share view");

    await userEvent.click(screen.getByLabelText("Close menu"));
    await waitFor(() => expect(screen.queryByText("Share view")).toBeNull());
  },
};

export const OverlaysMenuOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Overlays"));

    await expect(await screen.findByRole("button", { name: "Geoshapes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(screen.getByRole("button", { name: "Track Lines" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  },
};

export const TogglesOverlay: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Overlays"));

    const red = await screen.findByRole("button", { name: "Red" });

    await expect(red).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(red);
    await waitFor(() => expect(red).toHaveAttribute("aria-pressed", "false"));
  },
};

export const PluginLayerExpanded: Story = {
  beforeEach: () => seedEntities([roadClosures]),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Overlays"));
    await userEvent.click(await screen.findByText("Road closures"));

    await expect(await screen.findByText("60%")).toBeVisible();

    await userEvent.click(screen.getByText("Visible"));
    await expect(await screen.findByText("Hidden")).toBeVisible();
  },
};

export const ChangesLayerOpacity: Story = {
  beforeEach: () => seedEntities([roadClosures]),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Overlays"));
    await userEvent.click(await screen.findByText("Road closures"));
    await screen.findByText("60%");

    const slider = screen.getByRole("slider", { name: "Layer opacity" });

    await drag(trackPoint(slider, 0.6), trackPoint(slider, 0.2));
    await expect(await screen.findByText("20%")).toBeVisible();
  },
};

export const CollapsesPluginLayer: Story = {
  beforeEach: () => seedEntities([roadClosures]),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Overlays"));

    const layer = await screen.findByText("Road closures");

    await userEvent.click(layer);
    await screen.findByText("60%");

    await userEvent.click(layer);
    await waitFor(() => expect(screen.queryByText("60%")).toBeNull());
  },
};

export const ShareMenuOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Share"));

    await expect(await screen.findByText("Link to current entity or position")).toBeVisible();
    await expect(screen.getByText("Link with layout, layers and filters")).toBeVisible();
  },
};

export const RangeToolsOpen: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Range tools"));

    await expect(canvas.getByLabelText("Range tools")).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(canvas.getByLabelText("Bullseye")).toBeVisible());
  },
};

export const ArmsBullseye: Story = {
  play: async ({ canvas }) => {
    const rangeTools = canvas.getByLabelText("Range tools");

    await userEvent.click(rangeTools);
    await userEvent.click(canvas.getByLabelText("Bullseye"));

    await expect(rangeTools).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByLabelText("Bullseye")).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByLabelText("R&B")).toHaveAttribute("aria-pressed", "false");
  },
};

export const TogglesRange: Story = {
  play: async ({ canvas }) => {
    const rangeTools = canvas.getByLabelText("Range tools");
    const range = canvas.getByLabelText("R&B");

    await userEvent.click(rangeTools);
    await userEvent.click(range);
    await expect(range).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(rangeTools);
    await userEvent.click(range);
    await expect(range).toHaveAttribute("aria-pressed", "false");
  },
};

export const BullseyePlaced: Story = {
  beforeEach: () => seed(useBullseyeStore, { center: { lat: 52.52, lng: 13.4 } }),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Bullseye")).toHaveAttribute("aria-pressed", "true");
  },
};

export const CancelsBullseyeOnEscape: Story = {
  play: async ({ canvas }) => {
    const bullseye = canvas.getByLabelText("Bullseye");

    await userEvent.click(canvas.getByLabelText("Range tools"));
    await userEvent.click(bullseye);
    await expect(bullseye).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(bullseye).toHaveAttribute("aria-pressed", "false"));
  },
};

export const SavesEditOnEnter: Story = {
  beforeEach: [
    () => seedEntities([entity("range-1", { label: "Range to gate" })]),
    () => seed(useEditStore, movedTower),
    acceptPushes,
  ],
  play: async ({ canvas }) => {
    await canvas.findByLabelText("Zoom in");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(worldClient.push).toHaveBeenCalledOnce());

    const pushed = pushedLine();

    await expect(pushed.id).toBe("range-1");
    await expect(pushed.points).toEqual(gateToTower);
  },
};

export const ShowsEditSaveFailure: Story = {
  beforeEach: [
    () => seedEntities([entity("range-1", { label: "Range to gate" })]),
    () => seed(useEditStore, movedTower),
  ],
  play: async ({ canvas }) => {
    await canvas.findByLabelText("Zoom in");
    await userEvent.keyboard("{Enter}");

    await expect(
      await screen.findByText("worldClient.push called from a story"),
    ).toBeInTheDocument();
  },
};

export const FinishesRangeOnEnter: Story = {
  beforeEach: [
    () => seed(usePathStore, { paths: [measuring], drawingId: measuring.id }),
    () => {
      mocked(worldClient.getLocalNode).mockResolvedValue(
        create(GetLocalNodeResponseSchema, { nodeId: "node-7" }),
      );
    },
    acceptPushes,
  ],
  play: async ({ canvas }) => {
    await canvas.findByLabelText("Zoom in");
    await userEvent.keyboard("{Enter}");

    await waitFor(() =>
      expect(worldClient.push).toHaveBeenCalledWith({
        changes: [
          expect.objectContaining({
            id: expect.stringMatching(/^hydris\.rb\.node-7\./),
            label: "R&B",
          }),
        ],
      }),
    );

    await expect(pushedLine().points).toEqual(gateToTower);
  },
};

export const ShowsRangeSaveFailure: Story = {
  beforeEach: () => seed(usePathStore, { paths: [measuring], drawingId: measuring.id }),
  play: async ({ canvas }) => {
    await canvas.findByLabelText("Zoom in");
    await userEvent.keyboard("{Enter}");

    await expect(
      await screen.findByText("Failed to save R&B: worldClient.getLocalNode called from a story"),
    ).toBeInTheDocument();
  },
};

export const ZoomsIn: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Zoom in"));
    await expect(args.mapRef?.current?.zoomIn).toHaveBeenCalledOnce();
    await expect(args.mapRef?.current?.zoomOut).not.toHaveBeenCalled();
  },
};

export const ZoomsOut: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Zoom out"));
    await expect(args.mapRef?.current?.zoomOut).toHaveBeenCalledOnce();
    await expect(args.mapRef?.current?.zoomIn).not.toHaveBeenCalled();
  },
};

export const SharesFocus: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Share"));
    await userEvent.click(await screen.findByText("Share focus"));

    await expect(setStringAsync).toHaveBeenCalledOnce();
    await expect(setStringAsync).toHaveBeenCalledWith(
      `${location.origin}/aware?lat=52.52001&lng=13.40495&zoom=11.3`,
    );
    await expect(await screen.findByText("Link copied to clipboard")).toBeInTheDocument();
  },
};

export const SharesSelectedEntity: Story = {
  beforeEach: [
    () => seedEntities([entity("trk-7", { label: "TANGO 21" })]),
    () => seed(useSelectionStore, { selectedEntityId: "trk-7" }),
  ],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Share"));
    await userEvent.click(await screen.findByText("Share focus"));

    await expect(setStringAsync).toHaveBeenCalledOnce();
    await expect(setStringAsync).toHaveBeenCalledWith(
      `${location.origin}/aware?entityId=trk-7&zoom=11.3&lat=52.52001&lng=13.40495`,
    );
  },
};

export const SharesView: Story = {
  beforeEach: () => seed(useMapStore, { layer: "street" }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByLabelText("Share"));
    await userEvent.click(await screen.findByText("Share view"));
    await waitFor(() => expect(setStringAsync).toHaveBeenCalledOnce());

    const url = new URL(String(mocked(setStringAsync).mock.lastCall?.[0]));

    await expect(url.searchParams.get("lat")).toBe("52.52001");
    await expect(decodeViewState(url.searchParams.get("layout") ?? "")).toMatchObject({
      l: "street",
    });
  },
};
