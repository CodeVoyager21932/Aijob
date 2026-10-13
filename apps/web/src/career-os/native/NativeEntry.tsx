import { type ReactNode, useState } from "react";

/** Expansion belongs to the workspace, never to the saved resume content. */
export function NativeEntry({
  id,
  title,
  subtitle,
  hidden,
  initiallyOpen = false,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  hidden?: boolean;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      data-native-item={id}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        {subtitle && <small>{subtitle}</small>}
        {hidden && <small>已隐藏，内容保留</small>}
      </summary>
      {children}
    </details>
  );
}
