import { expect, waitFor } from "storybook/test";

const STRAY_TOAST_WINDOW_MS = 500;

function shown(): string[] {
  const toasts = document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])');

  return [...toasts].map((toast) => toast.textContent ?? "");
}

export async function exactToasts(count: number): Promise<string[]> {
  await waitFor(() => expect(shown()).toHaveLength(count));
  await new Promise((resolve) => setTimeout(resolve, STRAY_TOAST_WINDOW_MS));

  const toasts = shown();
  await expect(toasts).toHaveLength(count);

  return toasts;
}
