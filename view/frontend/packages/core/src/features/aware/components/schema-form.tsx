"use no memo";

import type { JsonObject } from "@bufbuild/protobuf";
import {
  ControlButton,
  ControlInput,
  ControlSelect,
  ControlSlider,
  ControlStepper,
  ToggleSwitch,
} from "@hydris/ui/controls";
import { useThemeColors } from "@hydris/ui/lib/theme";
import { cn } from "@hydris/ui/lib/utils";
import { ChevronDown, Eye, EyeOff } from "lucide-react-native";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { Alert, Platform, Pressable, Text, View } from "react-native";

type BaseField = {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  group?: string;
  order?: number;
  pattern?: string;
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

export function parseJsonSchema(schema: JsonObject): ParsedSchema {
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
      pattern: str(p.pattern),
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
      const options = (p.enum as unknown[])
        .filter((v): v is string => typeof v === "string")
        .map((v) => ({ value: v, label: v || "None" }));
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

function groupAndSort(
  fields: FieldDescriptor[],
  groups: GroupDef[],
): { group: GroupDef | null; fields: FieldDescriptor[] }[] {
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

  const sections: { group: GroupDef | null; fields: FieldDescriptor[] }[] = [];

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

  // leftover groups not declared in x-groups
  for (const [key, arr] of byGroup) {
    sections.push({
      group: { key, title: key.charAt(0).toUpperCase() + key.slice(1) },
      fields: arr.sort(sortByOrder),
    });
  }

  return sections;
}

function FieldLabel({
  label,
  required,
  onPress,
}: {
  label: string;
  required?: boolean;
  onPress?: () => void;
}) {
  const text = (
    <Text className="font-sans-medium text-foreground text-sm">
      {label}
      {required && <Text className="text-red-foreground"> *</Text>}
    </Text>
  );
  if (onPress) return <Pressable onPress={onPress}>{text}</Pressable>;
  return text;
}

function FieldHelper({ text }: { text?: string }) {
  if (!text) return null;
  return <Text className="text-muted-foreground font-mono text-xs">{text}</Text>;
}

function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <Text accessibilityRole="alert" className="text-red-foreground font-mono text-xs">
      {error}
    </Text>
  );
}

function FieldHeader({
  label,
  required,
  description,
  onPress,
}: {
  label: string;
  required?: boolean;
  description?: string;
  onPress?: () => void;
}) {
  return (
    <View className="gap-0.5">
      <FieldLabel label={label} required={required} onPress={onPress} />
      <FieldHelper text={description} />
    </View>
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
    <View className={cn("gap-1 py-3", field.readOnly && "cursor-not-allowed")}>
      <View className="flex-row items-center justify-between">
        <Pressable
          onPress={field.readOnly ? undefined : () => onChange(!value)}
          className="flex-1 gap-0.5"
          disabled={field.readOnly}
        >
          <View className="flex-row items-center gap-2">
            <Text className="font-sans-medium text-foreground text-sm">
              {field.label}
              {field.required && <Text className="text-red-foreground"> *</Text>}
            </Text>
            {field.dangerous && <Text className="text-red font-mono text-xs">DANGEROUS</Text>}
          </View>
          {field.description && (
            <Text className="text-muted-foreground font-mono text-xs">{field.description}</Text>
          )}
        </Pressable>
        <ToggleSwitch
          value={value}
          onValueChange={field.readOnly ? () => {} : onChange}
          accessibilityLabel={field.label}
        />
      </View>
      <FieldError error={error} />
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
  const inputRef = useRef<TextInput>(null);
  const [showPassword, setShowPassword] = useState(false);

  const isPassword = field.widget === "password";
  const isTextarea = field.widget === "textarea";

  return (
    <View className={cn("gap-1.5 py-3", field.readOnly && "cursor-not-allowed")}>
      <FieldHeader
        label={field.label}
        required={field.required}
        description={field.description}
        onPress={field.readOnly ? undefined : () => inputRef.current?.focus()}
      />
      <ControlInput
        ref={inputRef}
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
      <FieldError error={error} />
    </View>
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
  const inputRef = useRef<TextInput>(null);

  if (field.widget === "stepper") {
    const numVal =
      typeof value === "number" ? value : ((Number(value) || field.defaultValue) ?? field.min ?? 0);
    return (
      <View className={cn("gap-1.5 py-3", field.readOnly && "cursor-not-allowed")}>
        <FieldHeader
          label={field.label}
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
        <FieldError error={error} />
      </View>
    );
  }

  if (field.widget === "slider") {
    const numVal =
      typeof value === "number" ? value : ((Number(value) || field.defaultValue) ?? field.min ?? 0);
    return (
      <View className={cn("gap-1.5 py-3", field.readOnly && "cursor-not-allowed")}>
        <FieldHeader
          label={field.label}
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
        <FieldError error={error} />
      </View>
    );
  }

  const hint = getFieldHint(field);
  const helper = numberHelper(field.description, hint, field.unit);
  const strValue = value === "" || value === undefined ? "" : String(value);

  return (
    <View className={cn("gap-1.5 py-3", field.readOnly && "cursor-not-allowed")}>
      <FieldHeader
        label={field.label}
        required={field.required}
        description={helper}
        onPress={field.readOnly ? undefined : () => inputRef.current?.focus()}
      />
      <ControlInput
        ref={inputRef}
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
      <FieldError error={error} />
    </View>
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
  const options = field.options.map((o) => ({ value: String(o.value), label: o.label }));

  return (
    <View className={cn("gap-1.5 py-3", field.readOnly && "cursor-not-allowed")}>
      <FieldHeader label={field.label} required={field.required} description={field.description} />
      <ControlSelect
        value={value}
        options={options}
        onValueChange={field.readOnly ? () => {} : onChange}
        accessibilityLabel={field.label}
      />
      <FieldError error={error} />
    </View>
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
  const inputRef = useRef<TextInput>(null);
  return (
    <View className="gap-1.5 py-3">
      <FieldLabel label={field.label} onPress={() => inputRef.current?.focus()} />
      <ControlInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        multiline
        textAlignVertical="top"
        accessibilityLabel={field.label}
        className="min-h-20 p-3 text-xs"
      />
      <FieldError error={error} />
    </View>
  );
}

function FieldGroup({ group, children }: { group: GroupDef; children: React.ReactNode }) {
  const t = useThemeColors();
  const [collapsed, setCollapsed] = useState(group.collapsed ?? false);

  return (
    <View>
      <Pressable
        onPress={() => setCollapsed((c) => !c)}
        className="flex-row items-center gap-1.5 py-2"
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={`${group.title} section`}
      >
        <View
          style={{
            transform: [{ rotate: collapsed ? "-90deg" : "0deg" }],
          }}
        >
          <ChevronDown size={14} strokeWidth={2} color={t.controlFg} />
        </View>
        <Text className="font-sans-medium text-on-surface/70 text-xs tracking-widest uppercase">
          {group.title}
        </Text>
      </Pressable>
      {!collapsed && <View className="pl-1">{children}</View>}
    </View>
  );
}

type DraftValue = Record<string, unknown>;

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
    } else if (field.type === "boolean") {
      draft[field.key] = false;
    } else if (field.type === "number") {
      draft[field.key] = "";
    } else {
      draft[field.key] = "";
    }
  }
  return draft;
}

function draftToJsonObject(fields: FieldDescriptor[], draft: DraftValue): JsonObject {
  const result: JsonObject = {};
  for (const field of fields) {
    const v = draft[field.key];
    if (field.type === "number") {
      const n = Number(v);
      result[field.key] = Number.isNaN(n) ? 0 : n;
    } else if (field.type === "oneOf") {
      // oneOf can be string or number — preserve original type
      const opt = field.options.find((o) => String(o.value) === String(v));
      result[field.key] = opt ? opt.value : (v as string);
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

function isDirty(
  fields: FieldDescriptor[],
  draft: DraftValue,
  currentValue: JsonObject | undefined,
): boolean {
  for (const field of fields) {
    const draftVal = draft[field.key];
    const currentVal = currentValue?.[field.key];

    if (field.type === "number") {
      const draftNum = Number(draftVal);
      const currentNum = typeof currentVal === "number" ? currentVal : undefined;
      if (Number.isNaN(draftNum) && currentNum === undefined) continue;
      if (draftNum !== currentNum) return true;
    } else if (field.type === "boolean") {
      if (draftVal !== (currentVal ?? false)) return true;
    } else if (field.type === "unknown") {
      const draftStr = typeof draftVal === "string" ? draftVal : JSON.stringify(draftVal);
      const currentStr = currentVal !== undefined ? JSON.stringify(currentVal) : "";
      if (draftStr !== currentStr) return true;
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
        } else if (field.pattern && v) {
          try {
            if (!new RegExp(field.pattern).test(v)) {
              errors[field.key] = "does not match expected format";
            }
          } catch {
            // invalid regex in schema — skip validation
          }
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
) {
  const error = errors[field.key];
  switch (field.type) {
    case "boolean":
      return (
        <BooleanFieldComponent
          field={field}
          value={draft[field.key] as boolean}
          onChange={(v) => updateField(field.key, v)}
          error={error}
        />
      );
    case "string":
      return (
        <StringFieldComponent
          field={field}
          value={(draft[field.key] as string) ?? ""}
          onChange={(v) => updateField(field.key, v)}
          error={error}
          onSubmitEditing={onSubmitEditing}
        />
      );
    case "number":
      return (
        <NumberFieldComponent
          field={field}
          value={draft[field.key]}
          onChange={(v) => updateField(field.key, v)}
          error={error}
          onSubmitEditing={onSubmitEditing}
        />
      );
    case "oneOf":
      return (
        <OneOfFieldComponent
          field={field}
          value={String(draft[field.key] ?? "")}
          onChange={(v) => updateField(field.key, v)}
          error={error}
        />
      );
    case "unknown":
      return (
        <UnknownFieldComponent
          field={field}
          value={
            typeof draft[field.key] === "string"
              ? (draft[field.key] as string)
              : JSON.stringify(draft[field.key], null, 2)
          }
          onChange={(v) => updateField(field.key, v)}
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
      const draftVal = draft[field.key];
      const currentVal = currentValue?.[field.key] ?? false;
      if (draftVal !== currentVal) return field;
    }
  }
  return undefined;
}

export function SchemaForm({
  schema,
  value,
  onSubmit,
  onRemove,
  isPending,
  isConfigured,
}: {
  schema: JsonObject;
  value: JsonObject | undefined;
  onSubmit: (value: JsonObject) => Promise<void>;
  onRemove?: () => void;
  isPending: boolean;
  isConfigured: boolean;
}) {
  const submitRef = useRef<() => void>(() => {});
  const parsed = useMemo(() => parseJsonSchema(schema), [schema]);
  const sections = useMemo(() => groupAndSort(parsed.fields, parsed.groups), [parsed]);
  const [draft, setDraft] = useState<DraftValue>(() => buildInitialDraft(parsed.fields, value));
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);

  // Sync draft from server value, but only when the user hasn't touched the form.
  // This prevents live entity stream updates from clobbering in-progress edits.
  // After a successful submit, the parent resets `value` and `touched` clears via
  // the dirty/submit cycle, allowing the next server value to flow in.
  const prevValueJson = useRef(JSON.stringify(value));
  useEffect(() => {
    const json = JSON.stringify(value);
    if (prevValueJson.current === json) return;
    prevValueJson.current = json;
    if (touched.size > 0) return;
    setDraft(buildInitialDraft(parsed.fields, value));
    setSubmitted(false);
  }, [value, parsed.fields, touched.size]);

  const updateField = useCallback((key: string, v: unknown) => {
    setDraft((prev) => ({ ...prev, [key]: v }));
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const dirty = isDirty(parsed.fields, draft, value);
  const errors = validateDraft(parsed.fields, draft);
  const hasErrors = Object.keys(errors).length > 0;
  const enabled = (dirty || !isConfigured) && !hasErrors;

  const visibleErrors = useMemo(() => {
    if (submitted) return errors;
    const visible: Record<string, string> = {};
    for (const key of touched) {
      if (errors[key]) visible[key] = errors[key];
    }
    return visible;
  }, [submitted, touched, errors]);

  const submitLabel = isConfigured ? "Save configuration" : "Apply configuration";

  const handleSubmit = useCallback(async () => {
    setSubmitted(true);
    if (!enabled) return;

    const dangerousField = getDangerousChanges(parsed.fields, draft, value);
    if (dangerousField) {
      Alert.alert("Confirm", dangerousField.confirm!, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => onSubmit(draftToJsonObject(parsed.fields, draft)),
        },
      ]);
      return;
    }

    await onSubmit(draftToJsonObject(parsed.fields, draft));
  }, [enabled, parsed.fields, draft, value, onSubmit]);

  submitRef.current = handleSubmit;

  if (parsed.fields.length === 0) return null;

  return (
    <View className="px-4 py-2">
      <View className="gap-5">
        {sections.map((section) => {
          const content = section.fields.map((field, i) => (
            <Fragment key={field.key}>
              {renderField(field, draft, updateField, visibleErrors, () => submitRef.current())}
              {i < section.fields.length - 1 && <View className="bg-surface-overlay/6 h-px" />}
            </Fragment>
          ));

          if (!section.group) {
            return <View key="__ungrouped">{content}</View>;
          }

          return (
            <FieldGroup key={section.group.key} group={section.group}>
              {content}
            </FieldGroup>
          );
        })}
      </View>

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
        <ControlButton
          onPress={() => {
            if (Platform.OS === "web") {
              if (window.confirm("Remove configuration? The device will return to its defaults."))
                onRemove();
            } else {
              Alert.alert("Remove configuration", "The device will return to its defaults.", [
                { text: "Cancel", style: "cancel" },
                { text: "Remove", style: "destructive", onPress: onRemove },
              ]);
            }
          }}
          label="Remove configuration"
          hoverVariant="destructive"
          disabled={isPending}
          size="lg"
          fullWidth
          labelClassName="font-mono text-xs font-semibold uppercase"
          className="mt-2"
          accessibilityLabel="Remove configuration"
        />
      )}
    </View>
  );
}
