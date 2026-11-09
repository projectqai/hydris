import { describe, expect, it } from "vitest";

import type { SchemaSection } from "../../schema-form";
import { toSteps } from "./setup-pages";

type Field = SchemaSection["fields"][number];

function field(key: string): Field {
  return { key, label: key, type: "unknown" };
}

const stream = { key: "stream", title: "Stream" };
const connection = { key: "connection", title: "Connection" };
const credentials = { key: "credentials", title: "Credentials" };

describe("toSteps", () => {
  it("makes one step per group in order and puts fields outside every group on the last", () => {
    const steps = toSteps([
      { group: null, fields: [field("enable_direct_drive")] },
      { group: stream, fields: [field("fps")] },
      { group: connection, fields: [field("host")] },
      { group: credentials, fields: [field("username"), field("password")] },
    ]);

    expect(steps).toEqual([
      { group: stream, fields: [field("fps")] },
      { group: connection, fields: [field("host")] },
      {
        group: credentials,
        fields: [field("username"), field("password"), field("enable_direct_drive")],
      },
    ]);
  });

  it("makes one step without a group when the schema declares none", () => {
    expect(toSteps([{ group: null, fields: [field("host"), field("fps")] }])).toEqual([
      { group: null, fields: [field("host"), field("fps")] },
    ]);
  });

  it("makes one empty step for a schema without fields", () => {
    expect(toSteps([])).toEqual([{ group: null, fields: [] }]);
  });
});
