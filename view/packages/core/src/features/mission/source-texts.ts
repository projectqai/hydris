import { formatCaseLabel } from "../../lib/api/use-track-utils";
import type { SourceKind } from "./sources";

type Message = { title: string; subtitle: string };

type SetupTexts = { waiting: string; gone: string };

type SourceTexts = {
  title: string;
  connect: string;
  addService: string;
  allSetUp: Message;
  noDevices: Message;
};

export const WITHOUT_SERVICE = "Without a service";

export const OTHER_SERVICES = "Other services";

export function getSourceTexts(kind: SourceKind): SourceTexts {
  const label = formatCaseLabel(kind);

  return {
    title: label,
    connect: `Connect ${label} sources`,
    addService: `Add ${label} service`,
    allSetUp: {
      title: `Every ${label} service is set up`,
      subtitle: `${label} services not set up yet appear here`,
    },
    noDevices: {
      title: `No ${label} devices`,
      subtitle: `Discovered and set-up ${label} devices appear here`,
    },
  };
}

export type Subject = "service" | "device";

export const SUBJECT_TEXTS: Record<Subject, SetupTexts> = {
  service: { waiting: "Waiting for service settings", gone: "Service no longer exists" },
  device: {
    waiting: "Waiting for the service to send the settings form",
    gone: "No longer exists",
  },
};
