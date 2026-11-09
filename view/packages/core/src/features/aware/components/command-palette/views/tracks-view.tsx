import { selectTracks, useEntityStore } from "../../../store/entity-store";
import { EntityList } from "../entity-list";

export function TracksView({ query, onClose }: { query: string; onClose: () => void }) {
  const tracks = useEntityStore(selectTracks);

  return (
    <EntityList entities={tracks} query={query} emptyTitle="No tracks detected" onClose={onClose} />
  );
}
