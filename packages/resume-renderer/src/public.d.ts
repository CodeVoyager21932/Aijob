export interface LocalFont {
  type: "web";
  category: "sans-serif" | "serif";
  family: string;
  weights: ("400" | "700")[];
  preview: string;
  files: Record<string, string>;
}
export function installLocalFontCatalog(fonts: LocalFont[]): void;
export function renderNativeResumePreview(input: unknown): Promise<Blob>;
export interface NativeItemAnchor {
  page: number;
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  kind?: "field" | "text";
  targetId?: string;
  text?: string;
  label?: string;
  defaultFontSize?: number;
  alignmentAvailable?: boolean;
  stale?: boolean;
  lineBoxes?: { x: number; y: number; width: number; height: number; start: number; end: number }[];
  field?: "headline" | "email";
}
export function renderNativeResumePreviewWithLayout(
  input: unknown,
): Promise<{ blob: Blob; anchors: NativeItemAnchor[] }>;
export function renderNativeResumePdf(input: unknown): Promise<Uint8Array>;
export function renderNativeResumePdfWithLayout(
  input: unknown,
): Promise<{ bytes: Uint8Array; anchors: NativeItemAnchor[]; diagnostics: string[] }>;
export interface NativeSemanticNode {
  key: string;
  kind: string;
  id?: string;
  attributes: Readonly<Record<string, string>>;
  roles: readonly string[];
  children: readonly NativeSemanticNode[];
}
export function nativeResumeSemanticTree(input: unknown): NativeSemanticNode;
