import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "home"
  | "search"
  | "briefcase"
  | "document"
  | "interview"
  | "book"
  | "settings"
  | "collapse"
  | "menu"
  | "bell"
  | "user"
  | "board"
  | "list"
  | "close"
  | "chevron"
  | "external"
  | "check"
  | "warning"
  | "question"
  | "calendar"
  | "location";

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

function getIconPaths(name: IconName): ReactNode {
  switch (name) {
    case "home":
      return (
        <>
          <path d="m3.5 10.5 8.5-7 8.5 7" />
          <path d="M5.5 9.3V21h13V9.3M9.5 21v-6h5v6" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="10.8" cy="10.8" r="6.4" />
          <path d="m16 16 4.2 4.2" />
        </>
      );
    case "briefcase":
      return (
        <>
          <rect x="3" y="7" width="18" height="13" rx="2.5" />
          <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7M3 12.5h18M10 12.5v2h4v-2" />
        </>
      );
    case "document":
      return (
        <>
          <path d="M6 3.5h8l4 4V21H6z" />
          <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
        </>
      );
    case "interview":
      return (
        <>
          <path d="M4 5.5h16v11H9l-5 4z" />
          <path d="M8 10h8M8 13h5" />
        </>
      );
    case "book":
      return (
        <path d="M4 4.5h5.5A2.5 2.5 0 0 1 12 7v13a3 3 0 0 0-3-3H4zM20 4.5h-5.5A2.5 2.5 0 0 0 12 7v13a3 3 0 0 1 3-3h5z" />
      );
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.05.05-2.78 2.78-.05-.05A1.8 1.8 0 0 0 15 19.4a1.8 1.8 0 0 0-1.1 1.65V21h-3.9v-.07A1.8 1.8 0 0 0 8.95 19.3a1.8 1.8 0 0 0-1.98.36l-.05.05-2.78-2.78.05-.05A1.8 1.8 0 0 0 4.55 15a1.8 1.8 0 0 0-1.55-1.1H3v-3.9h.07A1.8 1.8 0 0 0 4.7 8.95a1.8 1.8 0 0 0-.36-1.98l-.05-.05 2.78-2.78.05.05A1.8 1.8 0 0 0 9 4.55a1.8 1.8 0 0 0 1.1-1.55V3h3.9v.07a1.8 1.8 0 0 0 1.05 1.63 1.8 1.8 0 0 0 1.98-.36l.05-.05 2.78 2.78-.05.05A1.8 1.8 0 0 0 19.45 9 1.8 1.8 0 0 0 21 10.1h.07V14H21A1.8 1.8 0 0 0 19.4 15Z" />
        </>
      );
    case "collapse":
      return <path d="m14.5 6-6 6 6 6M20 4v16" />;
    case "menu":
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case "bell":
      return (
        <>
          <path d="M18 9a6 6 0 1 0-12 0c0 7-3 7-3 8.5h18C21 16 18 16 18 9Z" />
          <path d="M10 21h4" />
        </>
      );
    case "user":
      return (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
        </>
      );
    case "board":
      return (
        <>
          <rect x="3" y="4" width="7" height="16" rx="1.5" />
          <rect x="14" y="4" width="7" height="10" rx="1.5" />
        </>
      );
    case "list":
      return (
        <>
          <path d="M8 6h12M8 12h12M8 18h12" />
          <circle cx="4" cy="6" r=".8" fill="currentColor" stroke="none" />
          <circle cx="4" cy="12" r=".8" fill="currentColor" stroke="none" />
          <circle cx="4" cy="18" r=".8" fill="currentColor" stroke="none" />
        </>
      );
    case "close":
      return <path d="m6 6 12 12M18 6 6 18" />;
    case "chevron":
      return <path d="m9 5 7 7-7 7" />;
    case "external":
      return (
        <>
          <path d="M14 4h6v6M20 4l-9 9" />
          <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
        </>
      );
    case "check":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16.5 9" />
        </>
      );
    case "warning":
      return (
        <>
          <path d="M12 3 2.8 20h18.4z" />
          <path d="M12 9v4.5M12 17h.01" />
        </>
      );
    case "question":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.7 9a2.5 2.5 0 1 1 3.3 2.36c-.75.28-1 .72-1 1.64M12 17h.01" />
        </>
      );
    case "calendar":
      return (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M7 3v4M17 3v4M3 10h18" />
        </>
      );
    case "location":
      return (
        <>
          <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
          <circle cx="12" cy="10" r="2.5" />
        </>
      );
  }
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {getIconPaths(name)}
    </svg>
  );
}
