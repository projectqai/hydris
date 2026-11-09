import { Card, CardArrow, CardContent, CardFooter, CardPill } from "@hydris/ui/card";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { useState } from "react";

import { getDeviceName } from "../../../lib/api/use-track-utils";
import type { StreamStatus } from "../../aware/components/video-stream/connection-overlay";
import { connectionLabel } from "../../aware/components/video-stream/connection-overlay";
import { VideoFeed } from "../../aware/components/video-stream/video-feed";
import { getEntityIcon } from "../../aware/utils/entity-helpers";
import { awaitsSetup } from "../sources";
import { useOwnState } from "../use-mission-state";
import { MissionTileAlert, MissionTileMessage } from "./mission-tile-message";
import { MissionTileHeader } from "./mission-tile-status";
import { NoisePlaceholder } from "./noise-placeholder";

export function CameraTile({
  camera,
  onPress,
  highlighted,
}: {
  camera: Entity;
  onPress: () => void;
  highlighted: boolean;
}) {
  const state = useOwnState(camera);
  const { variant } = state;
  const label = getDeviceName(camera);
  const stream = camera.camera?.streams[0];
  const discovered = awaitsSetup(camera);
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);

  const streamMessage =
    streamStatus && streamStatus.state !== "connected" ? connectionLabel(streamStatus) : null;

  const streamFailed = streamStatus?.state === "failed";
  // the feed reports its own status, so it stays mounted under the message to connect or recover
  const feedClassName = cn("flex-1 self-stretch", streamMessage && "absolute inset-0 opacity-0");

  const body = stream ? (
    <>
      <VideoFeed
        entityId={camera.id}
        stream={stream}
        index={0}
        objectFit="cover"
        enabled
        onPreviewStatus={setStreamStatus}
        className={feedClassName}
      />
      {streamMessage &&
        (streamFailed ? (
          <MissionTileAlert label={streamMessage} />
        ) : (
          <MissionTileMessage icon={getEntityIcon(camera)} label={streamMessage} />
        ))}
    </>
  ) : variant === "alert" ? (
    <MissionTileAlert label={state.label} />
  ) : (
    <MissionTileMessage icon={getEntityIcon(camera)} label={label} />
  );

  return (
    <Card variant={streamFailed ? "alert" : variant} onPress={onPress} highlighted={highlighted}>
      {((!stream && camera.config) || streamMessage) && <NoisePlaceholder />}
      <MissionTileHeader title={label} state={state} />
      <CardContent className="gap-2.5">
        {body}
        {discovered && <CardPill>Set up</CardPill>}
      </CardContent>
      <CardFooter>
        <CardArrow />
      </CardFooter>
    </Card>
  );
}
