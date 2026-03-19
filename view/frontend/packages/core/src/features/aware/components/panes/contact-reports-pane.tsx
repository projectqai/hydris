"use no memo";

import { Badge } from "@hydris/ui/badge";
import { EmptyState } from "@hydris/ui/empty-state";
import type { Entity } from "@projectqai/proto/world";
import { FlashList } from "@shopify/flash-list";
import { Clock, Compass, Radar, Radio } from "lucide-react-native";
import { memo, useRef, useState } from "react";
import { Text, View } from "react-native";

import { formatTime, getEntityName } from "../../../../lib/api/use-track-utils";
import { ENTITY_NAV_PARAMS, useUrlParams } from "../../../../lib/use-url-params";
import { EntityCardParts } from "../../entity-track-card";
import { selectDetections, useEntityStore } from "../../store/entity-store";
import { useMapEngine } from "../../store/map-engine-store";
import { useSelectionStore } from "../../store/selection-store";
import { extractShape, shapeCentroid } from "../../utils/transform-entities";

const { Root, Header, Row, DataItem, SourceItem } = EntityCardParts;

type ContactCardProps = {
  entity: Entity;
  isSelected?: boolean;
  onPress?: () => void;
};

function ContactCard({ entity, isSelected, onPress }: ContactCardProps) {
  const entities = useEntityStore((s) => s.entities);
  const classification = entity.detection?.classification;
  const detectorId = entity.detection?.detectorEntityId;
  const detector = detectorId ? entities.get(detectorId) : undefined;
  const detectorName = detector ? getEntityName(detector) : undefined;
  const azimuth = entity.bearing?.azimuth;
  const time = formatTime(entity.detection?.lastMeasured ?? entity.lifetime?.from);

  return (
    <Root isSelected={isSelected} onPress={onPress}>
      <Header title={classification?.toUpperCase() || getEntityName(entity)} />
      {detectorName && (
        <Row>
          <SourceItem icon={Radio} value={detectorName} />
        </Row>
      )}
      <Row>
        {azimuth !== undefined && <DataItem icon={Compass} value={`${azimuth.toFixed(0)}°`} />}
        {time && <DataItem icon={Clock} value={time} />}
      </Row>
    </Root>
  );
}

const PAGE_SIZE = 200;

function ContactReportsPaneComponent() {
  const detections = useEntityStore(selectDetections);
  const select = useSelectionStore((s) => s.select);
  const selectedEntityId = useSelectionStore((s) => s.selectedEntityId);
  const mapEngine = useMapEngine();
  const { clearParams } = useUrlParams();
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const listRef = useRef<any>(null);

  const displayed = detections.slice(0, displayCount);
  const hasMore = displayed.length < detections.length;

  const handlePress = (entity: Entity) => {
    clearParams(ENTITY_NAV_PARAMS);
    if (selectedEntityId === entity.id) {
      select(null);
    } else {
      select(entity.id);
      const geo = entity.geo;
      const shape = !geo ? extractShape(entity) : undefined;
      const centroid = shape ? shapeCentroid(shape) : undefined;
      const target = geo
        ? { lat: geo.latitude, lng: geo.longitude, alt: geo.altitude ?? 0 }
        : centroid;
      if (target) {
        const currentZoom = mapEngine.getView()?.zoom ?? 10;
        const targetZoom = Math.max(currentZoom, 14);
        mapEngine.flyTo(target.lat, target.lng, target.alt ?? 0, 1.5, targetZoom);
      }
    }
  };

  return (
    <View className="flex-1 select-none">
      <View className="border-foreground/5 flex-row items-center justify-between border-b px-3 pt-2 pb-2">
        <Text className="font-sans-medium text-foreground/70 text-sm">Contact Reports</Text>
        <Badge variant="neutral" size="sm">
          {detections.length}
        </Badge>
      </View>
      {detections.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No contact reports"
          subtitle="Waiting for sensor detections"
        />
      ) : (
        <FlashList
          ref={listRef}
          data={displayed}
          extraData={selectedEntityId}
          renderItem={({ item }) => (
            <ContactCard
              entity={item}
              isSelected={selectedEntityId === item.id}
              onPress={() => handlePress(item)}
            />
          )}
          keyExtractor={(item) => item.id}
          drawDistance={500}
          contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 12 }}
          showsVerticalScrollIndicator
          onEndReached={hasMore ? () => setDisplayCount((c) => c + PAGE_SIZE) : undefined}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}

export const ContactReportsPane = memo(ContactReportsPaneComponent);
