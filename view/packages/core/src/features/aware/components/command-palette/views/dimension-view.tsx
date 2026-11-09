import type { Category } from "@hydris/ui/command-palette/palette-reducer";
import type { Entity } from "@projectqai/proto/world";
import { useShallow } from "zustand/react/shallow";

import { useEntityStore } from "../../../store/entity-store";
import { EntityList } from "../entity-list";
import { classifyEntity, getAssetCategory, getBattleDimension } from "../palette-helpers";

export function DimensionView({
  dimension,
  category,
  query,
  onClose,
}: {
  dimension: string;
  category: Category;
  query: string;
  onClose: () => void;
}) {
  const inDimension = (entity: Entity) =>
    category === "assets"
      ? getAssetCategory(entity) === dimension
      : getBattleDimension(entity) === dimension;

  const dimensionEntities = useEntityStore(
    useShallow((s) =>
      Array.from(s.entities.values()).filter(
        (entity) => classifyEntity(entity) === category && inDimension(entity),
      ),
    ),
  );

  return (
    <EntityList
      entities={dimensionEntities}
      query={query}
      emptyTitle="No entities"
      onClose={onClose}
    />
  );
}
