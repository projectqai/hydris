import type { JsonObject } from "@bufbuild/protobuf";
import type { PaletteAction } from "@hydris/ui/command-palette/palette-reducer";
import { ControlButton, ControlIconButton } from "@hydris/ui/controls";
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from "@hydris/ui/empty-state";
import { cn } from "@hydris/ui/lib/utils";
import type { Entity } from "@projectqai/proto/world";
import { ArrowLeft, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { useState } from "react";
import { Text, View } from "react-native";

import { useEntityMutation } from "../../../../../lib/api/use-entity-mutation";
import {
  getDeviceName,
  getEntityError,
  getEntityName,
} from "../../../../../lib/api/use-track-utils";
import { MissionHeaderStatus } from "../../../../mission/components/mission-header-status";
import type { Subject } from "../../../../mission/source-texts";
import { SUBJECT_TEXTS } from "../../../../mission/source-texts";
import { declaresDevices, isDeviceRoot } from "../../../../mission/sources";
import { useOwnState } from "../../../../mission/use-mission-state";
import { useConfigHandshake } from "../../../hooks/use-config-handshake";
import { useDiscardUnsavedDevice } from "../../../hooks/use-discard-unsaved-device";
import { useEntityDelete } from "../../../hooks/use-entity-delete";
import { useEntityStore } from "../../../store/entity-store";
import { AddDeviceView, FormScroll, NO_SCHEMA } from "../../configuration-modal/config-panel";
import { ErrorNotice } from "../../error-notice";
import {
  hasSchemaFields,
  SchemaFieldList,
  sectionTitle,
  useDangerousConfirm,
  useSchemaDraft,
} from "../../schema-form";
import { WaitingForApply } from "../../waiting-for-apply";
import { BarIconButton } from "../bar-icon-button";
import { toSteps } from "./setup-pages";

const BUTTON_LABEL_CLASS = "font-mono text-xs font-semibold uppercase";

export function WizardHeader({
  entity,
  stepTitle,
  onClose,
}: {
  entity?: Entity;
  stepTitle?: ReactNode;
  onClose: () => void;
}) {
  const label = entity && getDeviceName(entity);
  const error = entity && getEntityError(entity);

  return (
    <>
      <View className="flex-row items-center gap-3 px-4 py-2.5">
        <View className="flex-1 gap-1">
          {entity && (
            <>
              {label !== entity.id && (
                <Text className="font-sans-semibold text-foreground text-base">{label}</Text>
              )}
              <Text className="text-muted-foreground font-mono text-xs">{entity.id}</Text>
            </>
          )}
        </View>
        {stepTitle ? (
          <Text
            accessibilityRole="header"
            className="text-on-surface/70 flex-1 text-center font-mono text-xs tracking-widest uppercase"
          >
            {stepTitle}
          </Text>
        ) : null}
        <View className={cn("flex-row justify-end", stepTitle && "flex-1")}>
          <BarIconButton icon={X} size={20} label="Close" onPress={onClose} />
        </View>
      </View>
      {error && <ErrorNotice className="mx-4 mb-3">{error}</ErrorNotice>}
    </>
  );
}

function SetupWizard({
  entity,
  schema,
  onDone,
}: {
  entity: Entity;
  schema: JsonObject;
  onDone: () => void;
}) {
  const value = entity.config?.value ?? entity.configurable?.value;

  const { parsed, sections, draft, updateField, errors, visibleErrors } = useSchemaDraft(
    schema,
    value,
  );

  const { pushDeviceConfig, isPending } = useEntityMutation();

  const handshake = useConfigHandshake(entity.configurable, {
    appliedMessage: `${getDeviceName(entity)} configuration applied`,
    onApplied: onDone,
  });

  const { request: requestDelete, dialog: deleteDialog } = useEntityDelete(onDone);
  const [step, setStep] = useState(0);
  const isSaving = isPending || handshake.awaiting;

  const save = (config: JsonObject) => handshake.push(() => pushDeviceConfig(entity, config));

  const { submit: finish, dialog: dangerousDialog } = useDangerousConfirm(
    parsed.fields,
    draft,
    value,
    save,
  );

  const steps = toSteps(sections);
  const index = Math.min(step, steps.length - 1);
  const current = steps[index]!;
  const isLast = index === steps.length - 1;
  const isValid = current.fields.every((field) => !errors[field.key]);
  const advance = isLast ? finish : () => setStep(index + 1);
  const advanceLabel = isLast ? "Finish" : "Next";
  const stepTitle = current.group && sectionTitle(current.fields, current.group.title);

  return (
    <View className="flex-1">
      <WizardHeader entity={entity} stepTitle={stepTitle} onClose={onDone} />
      <FormScroll contentContainerClassName="grow">
        <View className="flex-1 items-center justify-center px-4 py-6">
          <View className="w-full max-w-[522px]">
            <SchemaFieldList
              titled={current.group !== null}
              fields={current.fields}
              draft={draft}
              updateField={updateField}
              errors={visibleErrors}
            />
          </View>
        </View>
      </FormScroll>
      <WaitingForApply
        overdue={handshake.overdue}
        configurable={entity.configurable}
        className="justify-center px-4 pt-3"
      />
      <View className="flex-row items-center px-4 py-3">
        <View className="flex-1 flex-row items-center">
          {index > 0 ? (
            <ControlIconButton
              icon={ArrowLeft}
              onPress={() => setStep(index - 1)}
              size="sm"
              accessibilityLabel="Back"
            />
          ) : (
            !isDeviceRoot(entity) && (
              <ControlButton
                onPress={() => requestDelete(entity, "Delete device")}
                label="Delete"
                hoverVariant="destructive"
                size="sm"
                labelClassName={BUTTON_LABEL_CLASS}
                accessibilityLabel="Delete"
              />
            )
          )}
        </View>
        <Text className="text-muted-foreground flex-1 text-center font-mono text-xs">
          {`Step ${index + 1} of ${steps.length}`}
        </Text>
        <View className="flex-1 flex-row justify-end">
          <ControlButton
            key={advanceLabel}
            onPress={advance}
            label={advanceLabel}
            variant={isValid ? "success" : "default"}
            disabled={!isValid || isSaving}
            loading={isSaving}
            size="sm"
            labelClassName={BUTTON_LABEL_CLASS}
            accessibilityLabel={advanceLabel}
          />
        </View>
      </View>
      {deleteDialog}
      {dangerousDialog}
    </View>
  );
}

function SenderState({ sender }: { sender: Entity }) {
  const state = useOwnState(sender);

  return (
    <EmptyContent>
      <View className="flex-row items-center gap-2">
        <Text className="text-muted-foreground font-mono text-xs">{getDeviceName(sender)}</Text>
        <MissionHeaderStatus state={state} />
      </View>
      {state.error && <ErrorNotice>{state.error}</ErrorNotice>}
    </EmptyContent>
  );
}

function FormSender({ senderId }: { senderId: string }) {
  const sender = useEntityStore((s) => s.entities.get(senderId));

  if (!sender) return <EmptyDescription>{SUBJECT_TEXTS.service.gone}</EmptyDescription>;

  return <SenderState sender={sender} />;
}

export function SetupView({
  entityId,
  created,
  dispatch,
}: {
  entityId: string;
  created?: boolean;
  dispatch: React.Dispatch<PaletteAction>;
}) {
  useDiscardUnsavedDevice(created ? entityId : undefined);

  const entity = useEntityStore((s) => s.entities.get(entityId));
  const schema = entity?.configurable?.schema;
  const [seenAs, setSeenAs] = useState<Subject>();
  const close = () => dispatch({ type: "pop" });

  if (entity && !seenAs) setSeenAs(isDeviceRoot(entity) ? "service" : "device");

  const texts = SUBJECT_TEXTS[seenAs ?? "device"];

  if (entity && declaresDevices(entity) && !hasSchemaFields(schema)) {
    return (
      <View className="flex-1">
        <WizardHeader entity={entity} onClose={close} />
        <FormScroll>
          <AddDeviceView
            parentName={getEntityName(entity)}
            parentId={entity.id}
            options={entity.configurable?.supportedDeviceClasses ?? []}
            onCreated={(id) =>
              dispatch({ type: "replace", mode: { kind: "setup", entityId: id, created: true } })
            }
          />
        </FormScroll>
      </View>
    );
  }

  if (!entity || !schema || !hasSchemaFields(schema)) {
    const waitingTitle = !entity && seenAs ? texts.gone : texts.waiting;

    return (
      <View className="flex-1">
        <WizardHeader entity={entity} onClose={close} />
        <Empty>
          <EmptyTitle>{entity?.configurable ? NO_SCHEMA : waitingTitle}</EmptyTitle>
          {entity?.device?.parent && !entity.configurable && (
            <FormSender senderId={entity.device.parent} />
          )}
        </Empty>
      </View>
    );
  }

  return <SetupWizard entity={entity} schema={schema} onDone={close} />;
}
