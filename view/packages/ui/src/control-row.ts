import { cn } from "./lib/utils";

export const ROW_SIZE = "min-h-16 py-2";

// A framed list wraps its rows in a 1px border and a 4px gap
export const ROW_FRAME = "border p-1";
export const ROW_TEXT_INSET = "pl-4";

// A row without that frame starts its text 1px + 4px + 16px in, level with the framed rows' text
export const UNFRAMED_ROW_TEXT_INSET = "pl-[21px]";

const TITLE = "font-mono";
const DESCRIPTION = "font-sans text-13 leading-[18px]";

function rowText(color?: string) {
  return { title: cn(TITLE, color), description: cn(DESCRIPTION, color) };
}

export const ROW_TEXT_STYLES = {
  plain: rowText(),
  onGreen: rowText("text-foreground dark:text-control-input"),
  locked: rowText("text-muted-foreground/85"),
};
