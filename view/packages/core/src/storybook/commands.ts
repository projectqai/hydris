import type { Command } from "../features/aware/components/command-palette/command-registry";

export function command(list: Command[], id: string): Command {
  const found = list.find((c) => c.id === id);

  if (!found) throw new Error(`No command ${id}`);

  return found;
}
