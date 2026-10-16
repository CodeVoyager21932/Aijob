import { type Style, Text, type TextProps, View } from "@aijob/resume-forme/primitives";
import { isValidElement, type ReactNode } from "react";

export const localTextPrefix = "page-1/local-text/";
export function plainStudioText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainStudioText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return plainStudioText(node.props.children);
  return "";
}
/** Invisible semantic metadata survives the exact same primitive and layout tree. */
export function StudioEditableText({
  textId,
  label,
  sourceText,
  children,
  ...props
}: TextProps & {
  textId: string;
  label: string;
  sourceText?: string;
  children?: ReactNode;
}) {
  const tag = encodeURIComponent(
    JSON.stringify({ id: textId, label, text: sourceText ?? plainStudioText(children) }),
  );
  return (
    <Text {...props} data-resume-node={`${localTextPrefix}${tag}`}>
      {children}
    </Text>
  );
}

/** Contact values keep their own measured box while preserving the template's separator. */
export function StudioContacts({
  basics,
  separator,
  style,
}: {
  basics: { phone: string; email: string; location: string };
  separator: string;
  style: TextProps["style"];
}) {
  const fields = (["phone", "email", "location"] as const).filter((field) => basics[field]);
  const labels = { phone: "电话", email: "邮箱", location: "城市" };
  const flat = (Array.isArray(style) ? Object.assign({}, ...style) : (style ?? {})) as Style;
  return (
    <View
      style={[
        style,
        {
          justifyContent:
            flat.textAlign === "center"
              ? "center"
              : flat.textAlign === "right"
                ? "flex-end"
                : "flex-start",
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "baseline",
        },
      ]}
    >
      {fields.map((field, index) => (
        <View key={field} style={{ flexDirection: "row", alignItems: "baseline" }}>
          {index > 0 && <Text>{separator}</Text>}
          <StudioEditableText textId={`basics:${field}`} label={labels[field]}>
            {basics[field]}
          </StudioEditableText>
        </View>
      ))}
    </View>
  );
}
