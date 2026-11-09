import type { JsonObject } from "@bufbuild/protobuf";
import { ControlButton } from "@hydris/ui/controls";
import { drag, trackPoint } from "@hydris/ui/storybook/pointer";
import { shownAlertDialog } from "@hydris/ui/storybook/queries";
import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import { Timer } from "lucide-react-native";
import { View } from "react-native";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";

import { CONFIG_VALUE } from "../../../storybook/entities";
import { SchemaForm } from "./schema-form";

const host = {
  type: "string",
  title: "Host",
  description: "Address of the radar controller",
  pattern: "^[0-9.]+$",
  "ui:placeholder": "10.0.0.1",
  "ui:order": 1,
};

const port = { type: "integer", title: "Port", minimum: 1, maximum: 65535, "ui:order": 2 };

const schema: JsonObject = { type: "object", required: ["host"], properties: { host, port } };

function withField(key: string, field: JsonObject): JsonObject {
  return { ...schema, properties: { host, port, [key]: field } };
}

const abortCooldown = fn().mockName("abortCooldown");

const meta = {
  title: "Core/Aware/SchemaForm",
  component: SchemaForm,
  argTypes: {
    schema: { control: false },
    submitStatus: { control: false },
    extraActions: {
      control: "select",
      options: ["None", "Abort cooldown"],
      mapping: {
        None: undefined,
        "Abort cooldown": (
          <ControlButton
            icon={Timer}
            label="Abort cooldown (4:12)"
            size="lg"
            fullWidth
            className="mt-3"
            onPress={abortCooldown}
          />
        ),
      },
    },
  },
  args: {
    schema,
    value: CONFIG_VALUE,
    isPending: false,
    isConfigured: true,
    onSubmit: fn(async () => true),
  },
  decorators: [
    (Story) => (
      <View className="w-[420px]">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof SchemaForm>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Host")).toHaveValue("10.0.0.12");
    await expect(canvas.getByText("1–65535")).toBeVisible();
    await expect(canvas.getByLabelText("Save configuration")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const Unconfigured: Story = {
  args: { value: undefined, isConfigured: false },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Host")).toHaveAttribute("placeholder", "10.0.0.1");
    await expect(canvas.getByLabelText("Apply configuration")).toBeVisible();
    await expect(canvas.queryByText("required")).toBeNull();
  },
};

export const ShowsRequiredOnSubmit: Story = {
  args: { value: undefined, isConfigured: false },
  play: async ({ args, canvas }) => {
    await userEvent.type(canvas.getByLabelText("Port"), "8554{Enter}");
    await expect(canvas.getByRole("alert")).toHaveTextContent("required");
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

export const StoredValueOutOfRange: Story = {
  args: { value: { ...CONFIG_VALUE, port: 70_000 } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent("must be ≥ 1 and ≤ 65535");
    await expect(canvas.getByLabelText("Save configuration")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const ShowsFieldErrors: Story = {
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByLabelText("Host"), "-a");
    await expect(canvas.getByText("does not match expected format")).toBeVisible();

    await userEvent.type(canvas.getByLabelText("Port"), ".5");
    await expect(canvas.getByText("must be a whole number")).toBeVisible();
  },
};

export const EditsAndSaves: Story = {
  play: async ({ args, canvas }) => {
    const field = canvas.getByLabelText("Host");

    await userEvent.clear(field);
    await userEvent.type(field, "10.0.0.20");
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledOnce();
    await expect(args.onSubmit).toHaveBeenCalledWith({ host: "10.0.0.20", port: 8554 });
  },
};

export const Pending: Story = {
  args: { isPending: true },
  parameters: { a11y: { test: "todo" } },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Host")).toHaveAttribute("readonly");
    await expect(canvas.getByLabelText("Port")).toHaveAttribute("readonly");
  },
};

export const WithExtraActions: Story = {
  args: { extraActions: "Abort cooldown" },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Abort cooldown (4:12)")).toBeVisible();
  },
};

export const RemovesConfiguration: Story = {
  args: { onRemove: fn() },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Remove configuration"));

    const confirm = await shownAlertDialog("Remove configuration");

    await userEvent.click(confirm.getByText("Remove"));
    await expect(args.onRemove).toHaveBeenCalledOnce();
  },
};

export const CancelsRemove: Story = {
  args: { onRemove: fn() },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Remove configuration"));

    const confirm = await shownAlertDialog("Remove configuration");

    await userEvent.click(confirm.getByLabelText("Cancel"));
    await waitFor(() =>
      expect(screen.queryByRole("alert", { name: "Remove configuration" })).toBeNull(),
    );
    await expect(args.onRemove).not.toHaveBeenCalled();
  },
};

export const BooleanField: Story = {
  args: {
    schema: withField("enabled", {
      type: "boolean",
      title: "Enabled",
      description: "Stream tracks to the world",
    }),
    value: { ...CONFIG_VALUE, enabled: true },
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("switch", { name: "Enabled" }));
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledOnce();
    await expect(args.onSubmit).toHaveBeenCalledWith({
      host: "10.0.0.12",
      port: 8554,
      enabled: false,
    });
  },
};

export const DangerousBooleanConfirms: Story = {
  args: {
    schema: withField("transmit", {
      type: "boolean",
      title: "Transmit",
      "ui:dangerous": true,
      "ui:confirm": "The radar will emit at full power.",
    }),
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas, step }) => {
    await expect(canvas.getByText("DANGEROUS")).toBeVisible();

    await step("saving a dangerous change asks first and submits nothing", async () => {
      await userEvent.click(canvas.getByRole("switch", { name: "Transmit" }));
      await userEvent.click(canvas.getByLabelText("Save configuration"));

      const confirm = await shownAlertDialog("Confirm");

      await expect(confirm.getByText("The radar will emit at full power.")).toBeVisible();
      await expect(args.onSubmit).not.toHaveBeenCalled();
    });

    await step("Continue submits the change", async () => {
      await userEvent.click((await shownAlertDialog("Confirm")).getByText("Continue"));
      await expect(args.onSubmit).toHaveBeenCalledOnce();
      await expect(args.onSubmit).toHaveBeenCalledWith({
        host: "10.0.0.12",
        port: 8554,
        transmit: true,
      });
    });
  },
};

export const CancelsDangerousChange: Story = {
  args: DangerousBooleanConfirms.args,
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole("switch", { name: "Transmit" }));
    await userEvent.click(canvas.getByLabelText("Save configuration"));

    const confirm = await shownAlertDialog("Confirm");

    await userEvent.click(confirm.getByLabelText("Cancel"));
    await waitFor(() => expect(screen.queryByRole("alert", { name: "Confirm" })).toBeNull());
    await expect(args.onSubmit).not.toHaveBeenCalled();
  },
};

export const UntouchedDangerousFieldSavesDirectly: Story = {
  args: DangerousBooleanConfirms.args,
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    const field = canvas.getByLabelText("Host");

    await userEvent.clear(field);
    await userEvent.type(field, "10.0.0.20");
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledWith({ host: "10.0.0.20", port: 8554 });
  },
};

export const PasswordField: Story = {
  args: {
    schema: withField("token", { type: "string", title: "Token", "ui:widget": "password" }),
    value: { ...CONFIG_VALUE, token: "s3cret" },
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    const field = canvas.getByLabelText("Token");

    await expect(field).toHaveAttribute("type", "password");

    await userEvent.click(canvas.getByLabelText("Show password"));
    await expect(field).not.toHaveAttribute("type");
    await expect(canvas.getByLabelText("Hide password")).toBeVisible();
  },
};

export const TextareaField: Story = {
  args: {
    schema: withField("notes", {
      type: "string",
      title: "Notes",
      maxLength: 20,
      "ui:widget": "textarea",
    }),
    value: { ...CONFIG_VALUE, notes: "Mounted on the north mast, facing the harbour" },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent("maximum 20 characters");
  },
};

export const NumberWithUnit: Story = {
  args: {
    schema: withField("range", {
      type: "number",
      title: "Range",
      description: "Maximum detection range",
      exclusiveMinimum: 0,
      "ui:unit": "km",
    }),
    value: { ...CONFIG_VALUE, range: 12.5 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Maximum detection range · min 0 km")).toBeVisible();
    await expect(canvas.getByText("km")).toBeVisible();
  },
};

export const StepperField: Story = {
  args: {
    schema: withField("gain", {
      type: "integer",
      title: "Gain",
      minimum: 0,
      maximum: 10,
      "ui:widget": "stepper",
      "ui:unit": "dB",
    }),
    value: { ...CONFIG_VALUE, gain: 4 },
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByLabelText("Increase Gain"));
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledOnce();
    await expect(args.onSubmit).toHaveBeenCalledWith({
      host: "10.0.0.12",
      port: 8554,
      gain: 5,
    });
  },
};

export const SliderField: Story = {
  args: {
    schema: withField("sensitivity", {
      type: "integer",
      title: "Sensitivity",
      minimum: 0,
      maximum: 100,
      "ui:widget": "slider",
      "ui:unit": "%",
    }),
    value: { ...CONFIG_VALUE, sensitivity: 70 },
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    const slider = canvas.getByRole("slider", { name: "Sensitivity" });

    await drag(trackPoint(slider, 0.7), trackPoint(slider, 0.35), { steps: 1 });
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledOnce();
    await expect(args.onSubmit).toHaveBeenCalledWith({
      host: "10.0.0.12",
      port: 8554,
      sensitivity: 35,
    });
  },
};

export const OneOfField: Story = {
  args: {
    schema: withField("mode", {
      title: "Mode",
      oneOf: [
        { const: 1, title: "Monitoring" },
        { const: 2, title: "Tracking" },
      ],
    }),
    value: { ...CONFIG_VALUE, mode: 1 },
  },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Tracking"));
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledOnce();
    await expect(args.onSubmit).toHaveBeenCalledWith({
      host: "10.0.0.12",
      port: 8554,
      mode: 2,
    });
  },
};

export const UnknownFieldAsJson: Story = {
  args: {
    schema: withField("zones", { type: "array", title: "Zones" }),
    value: { ...CONFIG_VALUE, zones: ["north", "harbour"] },
  },
  play: async ({ canvas }) => {
    const field = canvas.getByLabelText("Zones");

    await expect(field).toHaveValue('[\n  "north",\n  "harbour"\n]');

    await userEvent.type(field, ",");
    await expect(canvas.getByRole("alert")).toHaveTextContent("invalid JSON");
  },
};

const everyKind: JsonObject = {
  type: "object",
  properties: {
    label: { type: "string", title: "Label" },
    preset: { type: "string", title: "Preset", default: "auto" },
    count: { type: "integer", title: "Count", minimum: 1 },
    rate: { type: "number", title: "Rate", default: 5 },
    backlight: { type: "boolean", title: "Backlight" },
    logging: { type: "boolean", title: "Logging", default: true },
    level: {
      title: "Level",
      oneOf: [
        { const: 1, title: "Low" },
        { const: 2, title: "High" },
      ],
    },
    profile: { type: "string", title: "Profile", enum: ["", "fast"] },
    zones: { type: "array", title: "Zones" },
  },
};

const everyKindStored: JsonObject = {
  label: "north mast",
  preset: "manual",
  count: 3,
  rate: 2.5,
  backlight: true,
  logging: false,
  level: 2,
  profile: "fast",
  zones: ["north"],
};

const onlyDefaultsStored: JsonObject = { preset: "auto", rate: 5, logging: true };

type Canvas = Parameters<NonNullable<Story["play"]>>[0]["canvas"];

async function expectSave(canvas: Canvas, enabled: boolean) {
  const save = canvas.getByLabelText("Save configuration");

  if (enabled) await expect(save).not.toHaveAttribute("aria-disabled", "true");
  else await expect(save).toHaveAttribute("aria-disabled", "true");
}

async function replace(canvas: Canvas, label: string, text: string) {
  const field = canvas.getByLabelText(label);

  await userEvent.clear(field);

  if (text) await userEvent.type(field, text);
}

export const EveryKindShowsStoredValues: Story = {
  args: { schema: everyKind, value: everyKindStored },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText("Label")).toHaveValue("north mast");
    await expect(canvas.getByLabelText("Preset")).toHaveValue("manual");
    await expect(canvas.getByLabelText("Count")).toHaveValue("3");
    await expect(canvas.getByLabelText("Rate")).toHaveValue("2.5");
    await expect(canvas.getByRole("switch", { name: "Backlight" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(canvas.getByRole("switch", { name: "Logging" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(canvas.getByRole("radio", { name: "High" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(canvas.getByRole("radio", { name: "fast" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(canvas.getByLabelText("Zones")).toHaveValue('[\n  "north"\n]');
    await expectSave(canvas, false);
  },
};

export const EveryKindUnsetShowsDefaults: Story = {
  args: { schema: everyKind, value: undefined, isConfigured: false },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await expect(canvas.getByLabelText("Label")).toHaveValue("");
    await expect(canvas.getByLabelText("Preset")).toHaveValue("auto");
    await expect(canvas.getByLabelText("Count")).toHaveValue("");
    await expect(canvas.getByLabelText("Rate")).toHaveValue("5");
    await expect(canvas.getByRole("switch", { name: "Logging" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(canvas.getByRole("radio", { name: "Low" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(canvas.getByRole("radio", { name: "High" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(canvas.getByLabelText("Zones")).toHaveValue("");

    await userEvent.click(canvas.getByLabelText("Apply configuration"));
    await expect(args.onSubmit).toHaveBeenCalledWith(onlyDefaultsStored);
  },
};

export const MissingUnsetKeysAreNotChanges: Story = {
  args: { schema: everyKind, value: onlyDefaultsStored },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await expectSave(canvas, false);
  },
};

export const MissingDefaultIsAChange: Story = {
  args: { schema: everyKind, value: { rate: 5, logging: true } },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await expectSave(canvas, true);
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledWith(onlyDefaultsStored);
  },
};

export const EditingBackIsNotAChange: Story = {
  args: { schema: everyKind, value: everyKindStored },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas, step }) => {
    await step("text", async () => {
      await replace(canvas, "Label", "south mast");
      await expectSave(canvas, true);
      await replace(canvas, "Label", "north mast");
      await expectSave(canvas, false);
    });

    await step("number", async () => {
      await replace(canvas, "Count", "4");
      await expectSave(canvas, true);
      await replace(canvas, "Count", "3");
      await expectSave(canvas, false);
    });

    await step("number emptied and refilled", async () => {
      await replace(canvas, "Rate", "");
      await expectSave(canvas, true);
      await replace(canvas, "Rate", "2.5");
      await expectSave(canvas, false);
    });

    await step("switch", async () => {
      const backlight = canvas.getByRole("switch", { name: "Backlight" });

      await userEvent.click(backlight);
      await expectSave(canvas, true);
      await userEvent.click(backlight);
      await expectSave(canvas, false);
    });

    await step("choice", async () => {
      await userEvent.click(canvas.getByRole("radio", { name: "Low" }));
      await expectSave(canvas, true);
      await userEvent.click(canvas.getByRole("radio", { name: "High" }));
      await expectSave(canvas, false);
    });

    await step("json", async () => {
      const zones = canvas.getByLabelText("Zones");

      await userEvent.type(zones, ",");
      await expectSave(canvas, false);
      await userEvent.type(zones, "{Backspace}");
      await expectSave(canvas, false);
    });
  },
};

export const ClearedFieldsAreLeftOut: Story = {
  args: { schema: everyKind, value: everyKindStored },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await replace(canvas, "Label", "");
    await replace(canvas, "Count", "");
    await replace(canvas, "Zones", "");
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledWith({
      preset: "manual",
      rate: 2.5,
      backlight: true,
      logging: false,
      level: 2,
      profile: "fast",
    });
  },
};

export const EditsSendTypedValues: Story = {
  args: { schema: everyKind, value: everyKindStored },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await replace(canvas, "Count", "7");
    await replace(canvas, "Rate", "0.5");
    await userEvent.click(canvas.getByRole("switch", { name: "Logging" }));
    await userEvent.click(canvas.getByRole("radio", { name: "Low" }));
    await userEvent.click(canvas.getByRole("radio", { name: "None" }));
    await replace(canvas, "Zones", "");
    await userEvent.click(canvas.getByLabelText("Zones"));
    await userEvent.paste('["north", "harbour"]');
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledWith({
      label: "north mast",
      preset: "manual",
      count: 7,
      rate: 0.5,
      backlight: true,
      logging: true,
      level: 1,
      profile: "",
      zones: ["north", "harbour"],
    });
  },
};

export const SaveIsOffWhileSending: Story = {
  args: { onSubmit: fn(() => new Promise<boolean>(() => {})) },
  parameters: { a11y: { test: "todo" } },
  play: async ({ args, canvas }) => {
    await replace(canvas, "Host", "10.0.0.20");
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledOnce();
    await expectSave(canvas, false);
  },
};

export const SaveIsOffWhilePending: Story = {
  args: { isPending: true },
  parameters: { a11y: { test: "todo" } },
  play: async ({ canvas }) => {
    await replace(canvas, "Host", "10.0.0.20");
    await expectSave(canvas, false);
  },
};

export const RejectedSaveKeepsEdits: Story = {
  args: { onSubmit: fn(async () => false) },
  play: async ({ args, canvas }) => {
    await replace(canvas, "Host", "10.0.0.20");
    await userEvent.click(canvas.getByLabelText("Save configuration"));
    await expect(args.onSubmit).toHaveBeenCalledOnce();
    await expect(canvas.getByLabelText("Host")).toHaveValue("10.0.0.20");
    await expectSave(canvas, true);
  },
};

export const CollapsedGroup: Story = {
  args: {
    schema: {
      ...schema,
      "ui:groups": [{ key: "advanced", title: "Advanced", collapsed: true }],
      properties: {
        host,
        port: { ...port, "ui:group": "advanced" },
      },
    },
  },
  play: async ({ canvas }) => {
    const header = canvas.getByRole("button", { name: "Port" });

    await expect(canvas.queryByLabelText("Port")).toBeNull();
    await expect(header).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(header);
    await expect(canvas.getByLabelText("Port")).toHaveValue("8554");
    await expect(header).toHaveAttribute("aria-expanded", "true");
  },
};

const labelledGroup: JsonObject = {
  type: "object",
  required: ["host"],
  "ui:groups": [{ key: "link", title: "Link" }],
  properties: {
    host: { ...host, "ui:group": "link" },
    enabled: {
      type: "boolean",
      title: "Enabled",
      description: "Stream tracks to the world",
      "ui:group": "link",
    },
    mode: {
      title: "Mode",
      oneOf: [
        { const: 1, title: "Monitoring" },
        { const: 2, title: "Tracking" },
      ],
      "ui:group": "link",
    },
  },
};

const labelledGroupStored: JsonObject = { host: "10.0.0.12", enabled: true, mode: 1 };

export const PressingALabelFocusesItsInput: Story = {
  args: { schema: labelledGroup, value: labelledGroupStored },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Host"));
    await expect(canvas.getByLabelText("Host")).toHaveFocus();
  },
};

export const PressingASwitchLabelToggles: Story = {
  args: { schema: labelledGroup, value: labelledGroupStored },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Enabled"));
    await expect(canvas.getByRole("switch", { name: "Enabled" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  },
};

export const PressingAChoiceLabelSelectsNothing: Story = {
  args: { schema: labelledGroup, value: { ...labelledGroupStored, mode: 2 } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Mode"));
    await expect(canvas.getByRole("radio", { name: "Tracking" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await userEvent.click(canvas.getByText("Monitoring"));
    await expect(canvas.getByRole("radio", { name: "Monitoring" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  },
};

export const ReadOnlyLabelsDoNothing: Story = {
  args: { schema: labelledGroup, value: labelledGroupStored, disabled: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Host"));
    await expect(canvas.getByLabelText("Host")).not.toHaveFocus();

    await userEvent.click(canvas.getByText("Enabled"));
    await expect(canvas.getByRole("switch", { name: "Enabled" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  },
};
