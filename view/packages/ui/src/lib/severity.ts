export type StateSeverity = "neutral" | "success" | "pending" | "alert";

export const SEVERITY_TEXT: Record<StateSeverity, string> = {
  neutral: "text-muted-foreground",
  success: "text-success-foreground",
  pending: "text-pending-foreground",
  alert: "text-red-foreground",
};

export const SEVERITY_DOT: Record<StateSeverity, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success-foreground",
  pending: "bg-pending-foreground",
  alert: "bg-red-foreground",
};
