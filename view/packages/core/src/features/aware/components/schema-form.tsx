"use no memo";

import type { JsonObject } from "@bufbuild/protobuf";
import {
  Accordion,
  AccordionContent,
  AccordionIndicator,
  AccordionItem,
  AccordionTitle,
  AccordionTrigger,
} from "@hydris/ui/accordion";
import {
  ControlButton,
  ControlInput,
  ControlSlider,
  ControlStepper,
  ToggleSwitch,
} from "@hydris/ui/controls";
import { ConfirmDialog } from "@hydris/ui/dialogs/confirm-dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTextContext,
  FieldTitle,
} from "@hydris/ui/field";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { RadioGroup, RadioGroupItem } from "@hydris/ui/radio-group";
import { Eye, EyeOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { Fragment, use, useCallback, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

type BaseField = {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  hideLabel?: boolean;
  group?: string;
  order?: number;
  patternRegex?: RegExp;
};

type BooleanField = BaseField & {
  type: "boolean";
  defaultValue?: boolean;
  dangerous?: boolean;
  confirm?: string;
};
type StringField = BaseField & {
  type: "string";
  defaultValue?: string;
  widget?: "password" | "textarea";
  minLength?: number;
  maxLength?: number;
};
type NumberField = BaseField & {
  type: "number";
  defaultValue?: number;
  isInteger?: boolean;
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  multipleOf?: number;
  unit?: string;
  step?: number;
  widget?: "stepper" | "slider";
};
type OneOfField = BaseField & {
  type: "oneOf";
  defaultValue?: string | number;
  options: { value: string | number; label: string }[];
};
type UnknownField = BaseField & { type: "unknown" };

type FieldDescriptor = BooleanField | StringField | NumberField | OneOfField | UnknownField;

type GroupDef = { key: string; title: string; collapsed?: boolean };

type ParsedSchema = { fields: FieldDescriptor[]; groups: GroupDef[] };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

// Returns undefined if the pattern is missing or not a valid regex. Schemas
// come from external sources so we can't crash validation over a bad pattern.
function compilePattern(pattern: string | undefined): RegExp | undefined {
  if (!pattern) return undefined;
  try {
    return new RegExp(pattern);
  } catch {
    return undefined;
  }
}

function parseJsonSchema(schema: JsonObject): ParsedSchema {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties))
    return { fields: [], groups: [] };

  const requiredArr = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const requiredSet = new Set(requiredArr);

  const groups: GroupDef[] = [];
  if (Array.isArray(schema["ui:groups"])) {
    for (const g of schema["ui:groups"] as Record<string, unknown>[]) {
      if (typeof g === "object" && g && typeof g.key === "string") {
        groups.push({
          key: g.key as string,
          title: str(g.title) ?? (g.key as string),
          collapsed: bool(g.collapsed),
        });
      }
    }
  }

  const fields: FieldDescriptor[] = [];

  for (const [key, raw] of Object.entries(properties)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      fields.push({ type: "unknown", key, label: key });
      continue;
    }

    const p = raw as Record<string, unknown>;
    const base: BaseField = {
      key,
      label: str(p.title) ?? key,
      description: str(p.description),
      placeholder: str(p["ui:placeholder"]),
      required: requiredSet.has(key),
      readOnly: bool(p.readOnly),
      group: str(p["ui:group"]),
      order: num(p["ui:order"]),
      patternRegex: compilePattern(str(p.pattern)),
    };

    // oneOf takes priority — works on any type
    if (Array.isArray(p.oneOf)) {
      const options = (p.oneOf as Record<string, unknown>[]).map((o) => ({
        value: (o.const ?? "") as string | number,
        label: str(o.title) ?? String(o.const ?? ""),
      }));
      fields.push({
        ...base,
        type: "oneOf",
        defaultValue: p.default as string | number | undefined,
        options,
      });
      continue;
    }

    // bare enum → convert to oneOf shape
    if (Array.isArray(p.enum)) {
      const options: { value: string; label: string }[] = [];
      for (const v of p.enum as unknown[]) {
        if (typeof v === "string") options.push({ value: v, label: v || "None" });
      }
      fields.push({
        ...base,
        type: "oneOf",
        defaultValue: str(p.default),
        options,
      });
      continue;
    }

    if (p.type === "boolean") {
      fields.push({
        ...base,
        type: "boolean",
        defaultValue: bool(p.default),
        dangerous: bool(p["ui:dangerous"]),
        confirm: str(p["ui:confirm"]),
      });
    } else if (p.type === "string") {
      const widget = str(p["ui:widget"]);
      fields.push({
        ...base,
        type: "string",
        defaultValue: str(p.default),
        widget: widget === "password" || widget === "textarea" ? widget : undefined,
        minLength: num(p.minLength),
        maxLength: num(p.maxLength),
      });
    } else if (p.type === "number" || p.type === "integer") {
      const widget = str(p["ui:widget"]);
      fields.push({
        ...base,
        type: "number",
        isInteger: p.type === "integer",
        defaultValue: num(p.default),
        min: num(p.minimum),
        max: num(p.maximum),
        exclusiveMin: num(p.exclusiveMinimum),
        exclusiveMax: num(p.exclusiveMaximum),
        multipleOf: num(p.multipleOf),
        unit: str(p["ui:unit"]),
        step: num(p["ui:step"]),
        widget: widget === "stepper" || widget === "slider" ? widget : undefined,
      });
    } else {
      fields.push({ ...base, type: "unknown" });
    }
  }

  return { fields, groups };
}

export type SchemaSection = { group: GroupDef | null; fields: FieldDescriptor[] };

function groupAndSort(fields: FieldDescriptor[], groups: GroupDef[]): SchemaSection[] {
  const ungrouped: FieldDescriptor[] = [];
  const byGroup = new Map<string, FieldDescriptor[]>();

  for (const f of fields) {
    if (f.group) {
      const arr = byGroup.get(f.group) ?? [];
      arr.push(f);
      byGroup.set(f.group, arr);
    } else {
      ungrouped.push(f);
    }
  }

  const sortByOrder = (a: FieldDescriptor, b: FieldDescriptor) => {
    const oa = a.order ?? 999;
    const ob = b.order ?? 999;
    if (oa !== ob) return oa - ob;
    return a.key.localeCompare(b.key);
  };

  const sections: SchemaSection[] = [];

  if (ungrouped.length > 0) {
    sections.push({ group: null, fields: ungrouped.sort(sortByOrder) });
  }

  // known groups in declared order
  for (const g of groups) {
    const arr = byGroup.get(g.key);
    if (arr) {
      sections.push({ group: g, fields: arr.sort(sortByOrder) });
      byGroup.delete(g.key);
    }
  }

  // leftover groups alphabetically for stable order
  const leftoverKeys = [...byGroup.keys()].sort((a, b) => a.localeCompare(b));
  for (const key of leftoverKeys) {
    sections.push({
      group: { key, title: key.charAt(0).toUpperCase() + key.slice(1) },
      fields: byGroup.get(key)!.sort(sortByOrder),
    });
  }

  return sections;
}

function RequiredTitle({ label, required }: { label: string; required?: boolean }) {
  const { title } = use(FieldTextContext);

  return (
    <FieldTitle>
      {label}
      {required && (
        <Text className={cn("font-sans-medium text-sm", title, "text-red-foreground")}>*</Text>
      )}
    </FieldTitle>
  );
}

function RequiredLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <FieldLabel>
      <RequiredTitle label={label} required={required} />
    </FieldLabel>
  );
}

function FieldHeader({
  label,
  hideLabel,
  required,
  description,
}: {
  label: string;
  hideLabel?: boolean;
  required?: boolean;
  description?: string;
}) {
  return (
    <FieldContent>
      {!hideLabel && <RequiredLabel label={label} required={required} />}
      {description && <FieldDescription>{description}</FieldDescription>}
    </FieldContent>
  );
}

function BooleanFieldComponent({
  field,
  value,
  onChange,
  error,
}: {
  field: BooleanField;
  value: boolean;
  onChange: (v: boolean) => void;
  error?: string;
}) {
  return (
    <View
      className={cn(
        "gap-1 py-3",
        field.hideLabel && "py-0",
        field.readOnly && "cursor-not-allowed",
      )}
    >
      <FieldLabel>
        <Field orientation="horizontal">
          <FieldContent>
            <View className="flex-row items-center gap-2">
              {!field.hideLabel && <RequiredTitle label={field.label} required={field.required} />}
              {field.dangerous && <Text className="text-red font-mono text-xs">DANGEROUS</Text>}
            </View>
            {field.description && <FieldDescription>{field.description}</FieldDescription>}
          </FieldContent>
          <ToggleSwitch
            value={value}
            onValueChange={onChange}
            accessibilityLabel={field.label}
            readOnly={field.readOnly}
          />
        </Field>
      </FieldLabel>
      <FieldError>{error}</FieldError>
    </View>
  );
}

function StringFieldComponent({
  field,
  value,
  onChange,
  error,
  onSubmitEditing,
}: {
  field: StringField;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  onSubmitEditing?: () => void;
}) {
  const t = useThemeColors();
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = field.widget === "password";
  const isTextarea = field.widget === "textarea";

  return (
    <Field
      className={cn("py-3", field.hideLabel && "py-0", field.readOnly && "cursor-not-allowed")}
    >
      <FieldHeader
        label={field.label}
        hideLabel={field.hideLabel}
        required={field.required}
        description={field.description}
      />
      <ControlInput
        value={value}
        onChangeText={field.readOnly ? () => {} : onChange}
        editable={!field.readOnly}
        placeholder={field.placeholder ?? ""}
        secureTextEntry={isPassword && !showPassword}
        multiline={isTextarea}
        textAlignVertical={isTextarea ? "top" : undefined}
        accessibilityLabel={field.label}
        onSubmitEditing={!isTextarea ? onSubmitEditing : undefined}
        className={cn(isTextarea && "min-h-20 p-3 text-xs", field.readOnly && "cursor-not-allowed")}
        suffix={
          isPassword ? (
            <Pressable
              onPress={() => setShowPassword((p) => !p)}
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              className="pr-3"
            >
              {showPassword ? (
                <EyeOff size={16} strokeWidth={2} color={t.controlFg} />
              ) : (
                <Eye size={16} strokeWidth={2} color={t.controlFg} />
              )}
            </Pressable>
          ) : undefined
        }
      />
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function NumberFieldComponent({
  field,
  value,
  onChange,
  error,
  onSubmitEditing,
}: {
  field: NumberField;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
  onSubmitEditing?: () => void;
}) {
  if (field.widget === "stepper") {
    const numVal =
      typeof value === "number" ? value : ((Number(value) || field.defaultValue) ?? field.min ?? 0);
    return (
      <Field
        className={cn("py-3", field.hideLabel && "py-0", field.readOnly && "cursor-not-allowed")}
      >
        <FieldHeader
          label={field.label}
          hideLabel={field.hideLabel}
          required={field.required}
          description={field.description}
        />
        <ControlStepper
          value={numVal}
          onValueChange={field.readOnly ? () => {} : (n) => onChange(n)}
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          unit={field.unit}
          readOnly={field.readOnly}
          accessibilityLabel={field.label}
        />
        <FieldError>{error}</FieldError>
      </Field>
    );
  }

  if (field.widget === "slider") {
    const numVal =
      typeof value === "number" ? value : ((Number(value) || field.defaultValue) ?? field.min ?? 0);
    return (
      <Field
        className={cn("py-3", field.hideLabel && "py-0", field.readOnly && "cursor-not-allowed")}
      >
        <FieldHeader
          label={field.label}
          hideLabel={field.hideLabel}
          required={field.required}
          description={field.description}
        />
        <ControlSlider
          value={numVal}
          onValueChange={field.readOnly ? () => {} : (n) => onChange(n)}
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          unit={field.unit}
          readOnly={field.readOnly}
          accessibilityLabel={field.label}
        />
        <FieldError>{error}</FieldError>
      </Field>
    );
  }

  const hint = getFieldHint(field);
  const helper = numberHelper(field.description, hint, field.unit);
  const strValue = value === "" || value === undefined ? "" : String(value);

  return (
    <Field
      className={cn("py-3", field.hideLabel && "py-0", field.readOnly && "cursor-not-allowed")}
    >
      <FieldHeader
        label={field.label}
        hideLabel={field.hideLabel}
        required={field.required}
        description={helper}
      />
      <ControlInput
        value={strValue}
        onChangeText={field.readOnly ? () => {} : onChange}
        editable={!field.readOnly}
        keyboardType="numeric"
        placeholder={
          field.placeholder ?? (field.defaultValue != null ? String(field.defaultValue) : "")
        }
        accessibilityLabel={field.label}
        onSubmitEditing={onSubmitEditing}
        className="tabular-nums"
        suffix={
          field.unit ? (
            <Text className="text-on-surface/65 pr-3 font-mono text-xs">{field.unit}</Text>
          ) : undefined
        }
      />
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function getFieldHint(field: NumberField): string | undefined {
  const lo = field.exclusiveMin ?? field.min;
  const hi = field.exclusiveMax ?? field.max;
  if (lo != null && hi != null) return `${lo}–${hi}`;
  if (lo != null) return `min ${lo}`;
  if (hi != null) return `max ${hi}`;
  return undefined;
}

function numberHelper(description?: string, hint?: string, unit?: string): string | undefined {
  const parts: string[] = [];
  if (description) parts.push(description);
  if (hint) parts.push(unit ? `${hint} ${unit}` : hint);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function OneOfFieldComponent({
  field,
  value,
  onChange,
  error,
}: {
  field: OneOfField;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field
      className={cn("py-3", field.hideLabel && "py-0", field.readOnly && "cursor-not-allowed")}
    >
      <FieldHeader
        label={field.label}
        hideLabel={field.hideLabel}
        required={field.required}
        description={field.description}
      />
      <RadioGroup
        value={value}
        onValueChange={onChange}
        disabled={field.readOnly}
        accessibilityLabel={field.label}
      >
        {field.options.map((o) => (
          <RadioGroupItem key={String(o.value)} value={String(o.value)}>
            {o.label}
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function UnknownFieldComponent({
  field,
  value,
  onChange,
  error,
}: {
  field: UnknownField;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field className={cn("py-3", field.hideLabel && "py-0")}>
      {!field.hideLabel && <RequiredLabel label={field.label} />}
      <ControlInput
        value={value}
        onChangeText={onChange}
        multiline
        textAlignVertical="top"
        accessibilityLabel={field.label}
        className="min-h-20 p-3 text-xs"
      />
      <FieldError>{error}</FieldError>
    </Field>
  );
}

// A field with no stored value and no default stays out of the draft. An emptied input holds "".
type DraftValue = Record<string, unknown>;

function isUnset(v: unknown): boolean {
  return v === undefined || v === "";
}

function buildInitialDraft(
  fields: FieldDescriptor[],
  currentValue: JsonObject | undefined,
): DraftValue {
  const draft: DraftValue = {};

  for (const field of fields) {
    const current = currentValue?.[field.key];

    if (current !== undefined) {
      draft[field.key] = current;
    } else if ("defaultValue" in field && field.defaultValue !== undefined) {
      draft[field.key] = field.defaultValue;
    }
  }

  return draft;
}

// Unset fields stay out of the config, so the device keeps its own value.
function draftToJsonObject(fields: FieldDescriptor[], draft: DraftValue): JsonObject {
  const result: JsonObject = {};

  for (const field of fields) {
    const v = draft[field.key];

    // An enum can offer "" as a real choice, so match options before the unset check.
    // Sending the option's value keeps numeric options numeric.
    if (field.type === "oneOf") {
      const opt = field.options.find((o) => String(o.value) === String(v));

      if (opt) result[field.key] = opt.value;
      else if (!isUnset(v)) result[field.key] = v as string;

      continue;
    }

    if (isUnset(v)) continue;

    if (field.type === "number") {
      result[field.key] = Number(v);
    } else if (field.type === "unknown") {
      try {
        result[field.key] = JSON.parse(v as string);
      } catch {
        result[field.key] = v as string;
      }
    } else {
      result[field.key] = v as string | boolean;
    }
  }

  return result;
}

function jsonFieldText(v: unknown): string {
  return typeof v === "string" ? v : (JSON.stringify(v, null, 2) ?? "");
}

function isDirty(
  fields: FieldDescriptor[],
  draft: DraftValue,
  currentValue: JsonObject | undefined,
): boolean {
  for (const field of fields) {
    const draftVal = draft[field.key];
    const currentVal = currentValue?.[field.key];

    if (field.type === "number") {
      const draftNum = isUnset(draftVal) ? undefined : Number(draftVal);
      const currentNum = typeof currentVal === "number" ? currentVal : undefined;

      if (draftNum !== currentNum) return true;
    } else if (field.type === "boolean") {
      if (draftVal !== currentVal) return true;
    } else if (field.type === "unknown") {
      if (jsonFieldText(draftVal) !== jsonFieldText(currentVal)) return true;
    } else {
      if (String(draftVal ?? "") !== String(currentVal ?? "")) return true;
    }
  }

  return false;
}

function numberRangeError(n: number, field: NumberField): string | undefined {
  const loInc = field.min;
  const loExc = field.exclusiveMin;
  const hiInc = field.max;
  const hiExc = field.exclusiveMax;

  const belowMin = (loInc != null && n < loInc) || (loExc != null && n <= loExc);
  const aboveMax = (hiInc != null && n > hiInc) || (hiExc != null && n >= hiExc);

  if (!belowMin && !aboveMax) return undefined;

  // effective bounds for combined message
  const lo = loExc ?? loInc;
  const hi = hiExc ?? hiInc;
  const loSign = loExc != null ? ">" : "≥";
  const hiSign = hiExc != null ? "<" : "≤";

  if (lo != null && hi != null) {
    return `must be ${loSign} ${lo} and ${hiSign} ${hi}`;
  }
  if (lo != null) return `must be ${loSign} ${lo}`;
  return `must be ${hiSign} ${hi}`;
}

function validateDraft(fields: FieldDescriptor[], draft: DraftValue): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (field.required) {
      const v = draft[field.key];
      if (v === "" || v === undefined || v === null) {
        errors[field.key] = "required";
        continue;
      }
    }

    if (field.type === "number") {
      const v = draft[field.key];
      if (v === "" || v === undefined) continue;
      const n = Number(v);
      if (Number.isNaN(n)) {
        errors[field.key] = "not a valid number";
        continue;
      }
      if (field.isInteger && !Number.isInteger(n)) {
        errors[field.key] = "must be a whole number";
        continue;
      }
      const rangeError = numberRangeError(n, field);
      if (rangeError) {
        errors[field.key] = rangeError;
        continue;
      }
      if (field.multipleOf != null && field.multipleOf !== 0) {
        const remainder = Math.abs(n % field.multipleOf);
        const epsilon = 1e-9;
        if (remainder > epsilon && Math.abs(remainder - Math.abs(field.multipleOf)) > epsilon) {
          errors[field.key] = `must be a multiple of ${field.multipleOf}`;
        }
      }
    } else if (field.type === "oneOf") {
      const v = draft[field.key];
      if (v !== "" && v !== undefined) {
        const valid = field.options.some((o) => String(o.value) === String(v));
        if (!valid) errors[field.key] = "not a valid option";
      }
    } else if (field.type === "string") {
      const v = draft[field.key];
      if (typeof v === "string") {
        if (field.minLength != null && v.length > 0 && v.length < field.minLength) {
          errors[field.key] = `minimum ${field.minLength} characters`;
        } else if (field.maxLength != null && v.length > field.maxLength) {
          errors[field.key] = `maximum ${field.maxLength} characters`;
        } else if (field.patternRegex && v && !field.patternRegex.test(v)) {
          errors[field.key] = "does not match expected format";
        }
      }
    } else if (field.type === "unknown") {
      const v = draft[field.key];
      if (typeof v === "string" && v.trim()) {
        try {
          JSON.parse(v);
        } catch {
          errors[field.key] = "invalid JSON";
        }
      }
    }
  }
  return errors;
}

function renderField(
  field: FieldDescriptor,
  draft: DraftValue,
  updateField: (key: string, v: unknown) => void,
  errors: Record<string, string>,
  onSubmitEditing?: () => void,
  formDisabled?: boolean,
) {
  const error = errors[field.key];
  const effectiveField = formDisabled ? ({ ...field, readOnly: true } as FieldDescriptor) : field;
  switch (effectiveField.type) {
    case "boolean":
      return (
        <BooleanFieldComponent
          field={effectiveField}
          value={draft[effectiveField.key] === true}
          onChange={(v) => updateField(effectiveField.key, v)}
          error={error}
        />
      );
    case "string":
      return (
        <StringFieldComponent
          field={effectiveField}
          value={(draft[effectiveField.key] as string) ?? ""}
          onChange={(v) => updateField(effectiveField.key, v)}
          error={error}
          onSubmitEditing={onSubmitEditing}
        />
      );
    case "number":
      return (
        <NumberFieldComponent
          field={effectiveField}
          value={draft[effectiveField.key]}
          onChange={(v) => updateField(effectiveField.key, v)}
          error={error}
          onSubmitEditing={onSubmitEditing}
        />
      );
    case "oneOf":
      return (
        <OneOfFieldComponent
          field={effectiveField}
          value={String(draft[effectiveField.key] ?? "")}
          onChange={(v) => updateField(effectiveField.key, v)}
          error={error}
        />
      );
    case "unknown":
      return (
        <UnknownFieldComponent
          field={effectiveField}
          value={jsonFieldText(draft[effectiveField.key])}
          onChange={(v) => updateField(effectiveField.key, v)}
          error={error}
        />
      );
  }
}

function getDangerousChanges(
  fields: FieldDescriptor[],
  draft: DraftValue,
  currentValue: JsonObject | undefined,
): BooleanField | undefined {
  for (const field of fields) {
    if (field.type === "boolean" && field.dangerous && field.confirm) {
      const draftVal = draft[field.key] ?? false;
      const currentVal = currentValue?.[field.key] ?? false;

      if (draftVal !== currentVal) return field;
    }
  }

  return undefined;
}

export function SchemaFieldList({
  fields,
  draft,
  updateField,
  errors,
  onSubmitEditing,
  disabled,
  titled,
}: {
  fields: FieldDescriptor[];
  draft: DraftValue;
  updateField: (key: string, v: unknown) => void;
  errors: Record<string, string>;
  onSubmitEditing?: () => void;
  disabled?: boolean;
  titled?: boolean;
}) {
  const hideLabel = titled === true && fields.length === 1;

  return fields.map((field, i) => (
    <Fragment key={field.key}>
      {renderField(
        hideLabel ? { ...field, hideLabel } : field,
        draft,
        updateField,
        errors,
        onSubmitEditing,
        disabled,
      )}
      {i < fields.length - 1 && <View className="bg-surface-overlay/6 h-px" />}
    </Fragment>
  ));
}

export function sectionTitle(fields: FieldDescriptor[], groupTitle: string): ReactNode {
  const only = fields.length === 1 ? fields[0] : undefined;

  if (!only) return groupTitle;

  return (
    <>
      {only.label}
      {only.required && <Text className="text-red-foreground"> *</Text>}
    </>
  );
}

export function SchemaSections({
  sections,
  draft,
  updateField,
  errors,
  onSubmitEditing,
  disabled,
}: {
  sections: SchemaSection[];
  draft: DraftValue;
  updateField: (key: string, v: unknown) => void;
  errors: Record<string, string>;
  onSubmitEditing?: () => void;
  disabled?: boolean;
}) {
  // field and group keys share one value space, so prefix them apart
  const items = sections.flatMap((section) =>
    section.group
      ? [
          {
            value: `group:${section.group.key}`,
            title: sectionTitle(section.fields, section.group.title),
            open: !section.group.collapsed,
            fields: section.fields,
          },
        ]
      : section.fields.map((field) => ({
          value: `field:${field.key}`,
          title: sectionTitle([field], field.label),
          open: true,
          fields: [field],
        })),
  );

  return (
    <Accordion
      type="multiple"
      defaultValue={items.filter((item) => item.open).map((item) => item.value)}
    >
      {items.map((item) => (
        <AccordionItem key={item.value} value={item.value}>
          <AccordionTrigger>
            <AccordionIndicator />
            <AccordionTitle>{item.title}</AccordionTitle>
          </AccordionTrigger>
          <AccordionContent>
            <SchemaFieldList
              fields={item.fields}
              draft={draft}
              updateField={updateField}
              errors={errors}
              onSubmitEditing={onSubmitEditing}
              disabled={disabled}
              titled
            />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

export function hasSchemaFields(schema: JsonObject | undefined): boolean {
  return !!schema && parseJsonSchema(schema).fields.length > 0;
}

export function useSchemaDraft(schema: JsonObject, value: JsonObject | undefined) {
  const parsed = useMemo(() => parseJsonSchema(schema), [schema]);
  const sections = useMemo(() => groupAndSort(parsed.fields, parsed.groups), [parsed]);
  const [edits, setEdits] = useState<DraftValue>({});
  const [submitted, setSubmitted] = useState(false);

  const draft = useMemo(
    () => ({ ...buildInitialDraft(parsed.fields, value), ...edits }),
    [parsed.fields, value, edits],
  );

  const updateField = useCallback((key: string, v: unknown) => {
    setEdits((prev) => ({ ...prev, [key]: v }));
  }, []);

  const clearEdits = useCallback(() => {
    setEdits({});
    setSubmitted(false);
  }, []);

  const errors = validateDraft(parsed.fields, draft);

  const visibleErrors = useMemo(() => {
    if (submitted) return errors;
    const visible: Record<string, string> = {};
    for (const [key, error] of Object.entries(errors)) {
      // A stored value that is out of range disables Save before the operator
      // touches anything, so show that error immediately. An empty field waits
      // until touched, or an unconfigured device opens covered in "required".
      const stored = value?.[key];

      if (key in edits || (stored !== undefined && stored !== "")) {
        visible[key] = error;
      }
    }
    return visible;
  }, [submitted, edits, errors, value]);

  return {
    parsed,
    sections,
    draft,
    updateField,
    errors,
    visibleErrors,
    setSubmitted,
    clearEdits,
  };
}

export function useDangerousConfirm(
  fields: FieldDescriptor[],
  draft: DraftValue,
  value: JsonObject | undefined,
  onSubmit: (value: JsonObject) => Promise<boolean>,
) {
  const [dangerousConfirm, setDangerousConfirm] = useState<{ message: string } | null>(null);

  const submit = async () => {
    const dangerousField = getDangerousChanges(fields, draft, value);

    if (dangerousField) {
      setDangerousConfirm({ message: dangerousField.confirm! });
      return;
    }

    await onSubmit(draftToJsonObject(fields, draft));
  };

  const dialog = (
    <ConfirmDialog
      visible={dangerousConfirm !== null}
      title="Confirm"
      message={dangerousConfirm?.message}
      confirmLabel="Continue"
      destructive
      onCancel={() => setDangerousConfirm(null)}
      onConfirm={() => {
        setDangerousConfirm(null);
        void onSubmit(draftToJsonObject(fields, draft));
      }}
    />
  );

  return { submit, dialog };
}

export function SchemaForm({
  schema,
  value,
  onSubmit,
  onRemove,
  isPending,
  isConfigured,
  extraActions,
  submitStatus,
  disabled,
}: {
  schema: JsonObject;
  value: JsonObject | undefined;
  onSubmit: (value: JsonObject) => Promise<boolean>;
  onRemove?: () => void;
  isPending: boolean;
  isConfigured: boolean;
  extraActions?: ReactNode;
  submitStatus?: ReactNode;
  disabled?: boolean;
}) {
  const submitRef = useRef<() => void>(() => {});

  const { parsed, sections, draft, updateField, errors, visibleErrors, setSubmitted, clearEdits } =
    useSchemaDraft(schema, value);

  const [removeOpen, setRemoveOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const save = async (config: JsonObject) => {
    setSending(true);
    const accepted = await onSubmit(config);
    setSending(false);

    if (accepted) clearEdits();

    return accepted;
  };

  const { submit, dialog: dangerousDialog } = useDangerousConfirm(
    parsed.fields,
    draft,
    value,
    save,
  );

  const dirty = isDirty(parsed.fields, draft, value);
  const hasErrors = Object.keys(errors).length > 0;
  const enabled = (dirty || !isConfigured) && !hasErrors && !disabled && !sending && !isPending;

  const submitLabel = isConfigured ? "Save configuration" : "Apply configuration";

  const submitOnEnter = Platform.OS === "web";
  const submitFromField = submitOnEnter ? () => submitRef.current() : undefined;

  const handleSubmit = async () => {
    setSubmitted(true);

    if (!enabled) return;

    await submit();
  };

  submitRef.current = handleSubmit;

  if (parsed.fields.length === 0) return null;

  return (
    <View className="px-4 py-2">
      <SchemaSections
        sections={sections}
        draft={draft}
        updateField={updateField}
        errors={visibleErrors}
        onSubmitEditing={submitFromField}
        disabled={disabled || sending}
      />

      {extraActions}

      {submitStatus}

      <ControlButton
        onPress={handleSubmit}
        label={submitLabel}
        variant={enabled ? "success" : "default"}
        disabled={!enabled}
        loading={isPending}
        size="lg"
        fullWidth
        labelClassName="font-mono text-xs font-semibold uppercase"
        className="mt-3"
        accessibilityLabel={submitLabel}
      />

      {onRemove && isConfigured && (
        <>
          <ControlButton
            onPress={() => setRemoveOpen(true)}
            label="Remove configuration"
            hoverVariant="destructive"
            disabled={isPending}
            size="lg"
            fullWidth
            labelClassName="font-mono text-xs font-semibold uppercase"
            className="mt-2"
            accessibilityLabel="Remove configuration"
          />
          <ConfirmDialog
            visible={removeOpen}
            title="Remove configuration"
            message="The device will return to its defaults."
            confirmLabel="Remove"
            destructive
            onCancel={() => setRemoveOpen(false)}
            onConfirm={() => {
              setRemoveOpen(false);
              onRemove();
            }}
          />
        </>
      )}
      {dangerousDialog}
    </View>
  );
}
