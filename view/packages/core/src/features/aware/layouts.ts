import type { ComponentType } from "react";

import { ChatPane } from "./components/panes/chat-pane";
import { ContactReportsPane } from "./components/panes/contact-reports-pane";
import { EntityDetailsPane } from "./components/panes/entity-details-pane";
import { EntityListPane } from "./components/panes/entity-list-pane";
import { MapPane } from "./components/panes/map-pane";
import { AlertsPlaceholder } from "./components/panes/placeholder-panes";
import { EnvironmentWidget } from "./widgets/environment-widget";
import { EquipmentWidget } from "./widgets/equipment-widget";
import { VitalWidget } from "./widgets/vital-widget";

export const COMPONENT_REGISTRY: Record<string, ComponentType> = {
  mapPane: MapPane,
  entityList: EntityListPane,
  entityDetails: EntityDetailsPane,
  contactReports: ContactReportsPane,
  alerts: AlertsPlaceholder,
  chat: ChatPane,
  environment: EnvironmentWidget,
  vitals: VitalWidget,
  equipment: EquipmentWidget,
};

export const COMPONENT_LABELS: Record<string, string> = {
  mapPane: "Map",
  entityList: "Entity List",
  entityDetails: "Detail",
  contactReports: "Contact Reports",
  alerts: "Alerts",
  chat: "Chat",
  environment: "Environment",
  vitals: "Vitals",
  equipment: "Equipment",
};
