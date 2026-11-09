import type { SchemaSection } from "../../schema-form";

export function toSteps(sections: SchemaSection[]): SchemaSection[] {
  const grouped = sections.filter((section) => section.group);
  const ungrouped = sections.find((section) => !section.group)?.fields ?? [];
  const last = grouped.at(-1);

  if (!last) return [{ group: null, fields: ungrouped }];

  return [...grouped.slice(0, -1), { group: last.group, fields: [...last.fields, ...ungrouped] }];
}
