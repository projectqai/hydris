import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { Empty, EmptyTitle } from "@hydris/ui/empty-state";
import { View } from "react-native";

import { useEntityStore } from "../../../store/entity-store";
import { ConfigurableSection, FormScroll } from "../../configuration-modal/config-panel";
import { WizardHeader } from "./setup-view";

export function SettingsView({
  entityId,
  dispatch,
}: {
  entityId: string;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  const entity = useEntityStore((s) => s.entities.get(entityId));

  return (
    <View className="flex-1">
      <WizardHeader entity={entity} onClose={() => dispatch({ type: "pop" })} />
      {entity ? (
        <FormScroll>
          <ConfigurableSection entity={entity} />
        </FormScroll>
      ) : (
        <Empty>
          <EmptyTitle>Entity no longer available</EmptyTitle>
        </Empty>
      )}
    </View>
  );
}
