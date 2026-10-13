import type { NativeTemplateId } from "@aijob/resume-core";

/** Intentionally a schematic, never a second rendering of a user's content. */
export function StudioTemplateSchematic({ id }: { id: NativeTemplateId }) {
  const columns = id === "studio-main-cn",
    compact = id === "studio-compact-cn",
    research = id === "studio-research-cn";
  const rows = compact
    ? [42, 56, 70, 84, 98, 112, 126, 140, 154, 168]
    : [46, 65, 84, 103, 122, 141, 160];
  return (
    <figure style={{ margin: "8px auto", maxWidth: 380, width: "100%" }}>
      <svg
        viewBox="0 0 160 220"
        role="img"
        aria-label={`${columns ? "宽正文窄侧栏" : research ? "科研连续多页" : compact ? "紧凑单栏" : "清晰单栏"}结构示意，非当前内容预览`}
        style={{ display: "block", width: "100%", background: "#fff", border: "1px solid #d4dadc" }}
      >
        <title>模板结构示意</title>
        <rect x="13" y="14" width="43" height="6" fill="#24424f" />
        <rect x="13" y="25" width="95" height="2" fill="#a2adb2" />
        {!research && <path d="M13 33H147" stroke="#24424f" strokeWidth="1" />}
        {rows.map((y) => (
          <g key={y}>
            <rect
              x="13"
              y={y}
              width={columns ? "80" : "126"}
              height="2.2"
              fill={y === rows[0] || y === rows[3] ? "#24424f" : "#a2adb2"}
            />
            <rect x="13" y={y + 6} width={columns ? "75" : "116"} height="1.6" fill="#c5cccf" />
            {columns && <rect x="112" y={y} width="33" height="2" fill="#a2adb2" />}
          </g>
        ))}
        {research && (
          <>
            <path d="M125 205H151V178" fill="none" stroke="#78888f" />
            <text x="15" y="207" fontSize="6" fill="#78888f">
              正文自然续页
            </text>
          </>
        )}
      </svg>
      <figcaption style={{ fontSize: 12, color: "#64747a", marginTop: 6 }}>
        结构示意；应用后查看当前内容的正式预览
      </figcaption>
    </figure>
  );
}
