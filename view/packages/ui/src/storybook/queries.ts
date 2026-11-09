import type { queries } from "storybook/test";
import { screen, within } from "storybook/test";

export type Canvas = ReturnType<typeof within<typeof queries>>;

export async function shownDialog() {
  return within(await screen.findByRole("dialog"));
}

export async function shownAlertDialog(title: string) {
  await shownDialog();

  return within(await screen.findByRole("alert", { name: title }));
}

export function backdropClose(canvas: Canvas, dialog: HTMLElement): HTMLElement {
  const backdrop = canvas.getAllByLabelText("Close").find((close) => !dialog.contains(close));

  if (!backdrop) throw new Error("No close control outside the dialog");

  return backdrop;
}

// Text queries also match copies of a label that are hidden from assistive tech
export const IGNORE_HIDDEN = {
  ignore: 'script, style, [aria-hidden="true"], [aria-hidden="true"] *',
};

export function toasts() {
  return within(screen.getByRole("region", { name: /^Notifications/ }));
}

export function wholeText(text: string) {
  return (_: string, element: Element | null) =>
    element?.tagName === "DIV" &&
    element.getAttribute("dir") === "auto" &&
    element.textContent === text;
}

export function accessibleName(element: HTMLElement) {
  return element.getAttribute("aria-label") ?? element.textContent;
}

export function pressable(label: HTMLElement): Element {
  const element = label.closest("[tabindex]");

  if (!element) throw new Error("No focusable element around the label");

  return element;
}

export function marker(name: HTMLElement, label: string): HTMLElement {
  const row = name.closest<HTMLElement>("[tabindex]");

  if (!row) throw new Error("No focusable row around the name");

  return within(row).getByLabelText(label, { selector: "svg" });
}
