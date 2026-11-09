import type { Meta, StoryObj } from "@storybook/react-native-web-vite";
import type { ComponentProps, ReactNode } from "react";
import { Component } from "react";
import { Text, View } from "react-native";
import { expect, fn, userEvent } from "storybook/test";

import { ControlInput } from "./controls/control-input";
import { ToggleSwitch } from "./controls/toggle-switch";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "./field";

type CaughtError = { message?: string };

class ShowCaughtError extends Component<{ children: ReactNode }, CaughtError> {
  override state: CaughtError = {};

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  override render() {
    if (this.state.message) {
      return (
        <Text accessibilityRole="alert" className="text-red-foreground font-mono text-xs">
          {this.state.message}
        </Text>
      );
    }

    return this.props.children;
  }
}

type FieldStoryArgs = ComponentProps<typeof Field> & {
  title?: string;
  description: string;
  error?: string;
  value: boolean;
  onToggle: (value: boolean) => void;
};

const meta = {
  title: "UI/Controls/Field",
  component: Field,
  subcomponents: { FieldContent, FieldLabel, FieldTitle, FieldDescription, FieldError },
  args: {
    title: "Layouts",
    description: "Your saved dashboard layouts",
    value: false,
    onToggle: fn(),
  },
  argTypes: {
    orientation: { control: "radio", options: ["vertical", "horizontal"] },
    onToggle: { control: false },
  },
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <View className="w-[480px]">
        <Story />
      </View>
    ),
  ],
  render: function Render({ title, description, error, value, onToggle, ...args }) {
    if (args.orientation === "horizontal") {
      return (
        <FieldLabel>
          <Field {...args}>
            <FieldContent>
              {title && <FieldTitle>{title}</FieldTitle>}
              <FieldDescription>{description}</FieldDescription>
            </FieldContent>
            <ToggleSwitch
              value={value}
              onValueChange={onToggle}
              accessibilityLabel={title ?? description}
            />
          </Field>
        </FieldLabel>
      );
    }

    return (
      <Field {...args}>
        <FieldContent>
          {title && (
            <FieldLabel>
              <FieldTitle>{title}</FieldTitle>
            </FieldLabel>
          )}
          <FieldDescription>{description}</FieldDescription>
        </FieldContent>
        <ControlInput value="10.0.0.12" accessibilityLabel={title} />
        <FieldError>{error}</FieldError>
      </Field>
    );
  },
} satisfies Meta<FieldStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithError: Story = {
  args: { error: "does not match expected format" },
};

export const Horizontal: Story = {
  args: { orientation: "horizontal" },
};

export const HorizontalWithoutTitle: Story = {
  args: {
    orientation: "horizontal",
    title: undefined,
    description: "When enabled, records every sensor reading",
  },
};

export const LongDescriptionWrapsBesideControl: Story = {
  args: {
    orientation: "horizontal",
    description:
      "Camera snapshots, recordings and other attachments that the world refers to, bundled into the pack",
  },
};

export const PressingTheRowToggles: Story = {
  args: { orientation: "horizontal", value: true },
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByText("Your saved dashboard layouts"));
    await expect(args.onToggle).toHaveBeenCalledOnce();
    await expect(args.onToggle).toHaveBeenCalledWith(false);
  },
};

export const PressingTheLabelFocusesTheInput: Story = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByText("Layouts"));
    await expect(canvas.getByLabelText("Layouts")).toHaveFocus();
  },
};

export const SecondControlInOneFieldThrows: Story = {
  decorators: [
    (Story) => (
      <ShowCaughtError>
        <Story />
      </ShowCaughtError>
    ),
  ],
  render: function Render({ title, description, value, onToggle, ...args }) {
    return (
      <Field {...args}>
        <FieldLabel>
          <FieldTitle>{title}</FieldTitle>
        </FieldLabel>
        <ControlInput value="10.0.0.12" accessibilityLabel={title} />
        <ToggleSwitch value={value} onValueChange={onToggle} accessibilityLabel={description} />
      </Field>
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "A field can contain one control",
    );
  },
};

export const TabStopsOnlyAtTheControl: Story = {
  args: { orientation: "horizontal" },
  play: async ({ canvas }) => {
    await userEvent.tab();
    await expect(canvas.getByRole("switch", { name: "Layouts" })).toHaveFocus();
  },
};
