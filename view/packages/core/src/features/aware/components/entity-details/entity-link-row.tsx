import type { ComponentType } from "react";

import { getEntityName } from "../../../../lib/api/use-track-utils";
import { useEntityStore } from "../../store/entity-store";
import { focusEntity } from "../../utils/focus-entity";
import { LinkRow } from "./link-row";

type EntityLinkRowProps = {
  icon?: ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  entityId: string;
};

export function EntityLinkRow({ icon: Icon, label, entityId }: EntityLinkRowProps) {
  const linkedEntity = useEntityStore((s) => s.entities.get(entityId));
  const name = linkedEntity ? getEntityName(linkedEntity) : entityId.slice(0, 8);

  return (
    <LinkRow
      icon={Icon}
      label={label}
      value={name}
      onPress={() => focusEntity(entityId)}
      accessibilityLabel={`Navigate to ${name}`}
    />
  );
}
