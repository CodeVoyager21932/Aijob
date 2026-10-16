import type { NativeTemplateId } from "@aijob/resume-core";

const featuredStructures: Partial<Record<NativeTemplateId, { label: string; color: string }>> = {
  "studio-campus-cn": { label: "曲线页首与通栏正文", color: "#3e7be0" },
  "studio-banner-cn": { label: "短横幅与通栏章节", color: "#a44353" },
  "studio-index-cn": { label: "左侧章节索引与宽正文", color: "#203b50" },
  "studio-sidebar-cn": { label: "资料侧栏与经历主栏", color: "#146c7a" },
  "studio-layered-cn": { label: "照片跨接短名片与连续正文面板", color: "#3559a8" },
  "studio-cards-cn": { label: "小页首与独立圆角模块", color: "#3f7c70" },
};

function SampleLines({
  x,
  y,
  width,
  color = "#b8c1c8",
}: {
  x: number;
  y: number;
  width: number;
  color?: string;
}) {
  return (
    <>
      <rect x={x} y={y} width={width} height="2" fill={color} />
      <rect x={x} y={y + 6} width={width * 0.93} height="2" fill="#d0d7dc" />
      <rect x={x} y={y + 12} width={width * 0.82} height="2" fill="#d0d7dc" />
    </>
  );
}

function FeaturedSchematic({
  id,
  label,
  color,
}: {
  id: NativeTemplateId;
  label: string;
  color: string;
}) {
  const side = id === "studio-sidebar-cn";
  const index = id === "studio-index-cn";
  const banner = id === "studio-banner-cn";
  const layered = id === "studio-layered-cn";
  const cards = id === "studio-cards-cn";
  return (
    <figure style={{ margin: "8px auto", maxWidth: 380, width: "100%" }}>
      <svg
        viewBox="0 0 210 297"
        role="img"
        aria-label={`${label}结构示意，非当前内容预览`}
        style={{
          display: "block",
          width: "100%",
          background: cards ? "#f6f9f7" : "#fff",
          border: "1px solid #d4dadc",
        }}
      >
        <title>{label} · A4 单页结构</title>
        {side ? (
          <>
            <rect x="0" y="0" width="55" height="297" fill={color} />
            <rect x="13" y="17" width="29" height="38" rx="2" fill="#d9e9ec" />
            <rect x="10" y="66" width="35" height="5" fill="#fff" />
            {[81, 115, 152, 188, 224].map((y) => (
              <SampleLines key={y} x={10} y={y} width={34} color="#e8f2f3" />
            ))}
            <rect x="67" y="24" width="53" height="6" fill={color} />
            <rect x="67" y="37" width="126" height="2" fill="#b8c1c8" />
          </>
        ) : layered ? (
          <>
            <rect x="14" y="19" width="182" height="37" rx="3" fill="#e8edf7" />
            <rect x="14" y="64" width="182" height="218" rx="3" fill="#fff" stroke="#d8dfea" />
            <rect
              x="26"
              y="12"
              width="30"
              height="40"
              rx="2"
              fill={color}
              stroke="#fff"
              strokeWidth="3"
            />
            <rect x="67" y="28" width="49" height="6" fill={color} />
            <rect x="67" y="41" width="108" height="2" fill="#a3b3cc" />
          </>
        ) : banner || index ? (
          <>
            <rect x="0" y="0" width="210" height="44" fill={color} />
            <rect x="16" y="13" width="48" height="6" fill="#fff" />
            <rect x="16" y="26" width="131" height="2" fill="#e1e6ed" />
            <rect x="170" y="8" width="24" height="29" rx="1" fill="#e5e9ed" />
            {index && <path d="M26 59V273" stroke="#b9c7d1" />}
          </>
        ) : cards ? (
          <>
            <rect x="14" y="12" width="182" height="2" fill={color} />
            <rect x="17" y="25" width="49" height="6" fill={color} />
            <rect x="17" y="39" width="126" height="2" fill="#a5bbb4" />
            <rect x="170" y="22" width="23" height="30" rx="2" fill="#dce9e3" />
          </>
        ) : (
          <>
            <path d="M0 0H210V30Q110 70 0 30Z" fill={color} />
            <circle cx="105" cy="36" r="16" fill="#dce7f8" stroke="#fff" strokeWidth="3" />
            <rect x="82" y="58" width="46" height="6" fill={color} />
            <rect x="39" y="71" width="132" height="2" fill="#b8c1c8" />
          </>
        )}
        {(side
          ? [58, 113, 168, 223]
          : layered
            ? [77, 124, 171, 218]
            : cards
              ? [66, 118, 170, 222]
              : id === "studio-campus-cn"
                ? [87, 136, 185, 234]
                : [57, 112, 167, 222]
        ).map((y) => {
          const x = side ? 67 : index ? 48 : layered ? 24 : cards ? 24 : 16;
          const width = side ? 126 : index ? 146 : layered || cards ? 162 : 178;
          return (
            <g key={y}>
              {cards && (
                <rect
                  x="14"
                  y={y - 7}
                  width="182"
                  height="46"
                  rx="5"
                  fill="#fff"
                  stroke="#e3ebe6"
                />
              )}
              {banner && <rect x="14" y={y - 3} width="182" height="10" fill="#f5e8eb" />}
              {index && (
                <>
                  <circle cx="26" cy={y + 1} r="5" fill={color} />
                  <rect x="17" y={y + 12} width="18" height="2" fill={color} />
                </>
              )}
              <rect x={x} y={y} width={index ? 57 : 42} height="3" fill={color} />
              <SampleLines x={x} y={y + 12} width={width} />
              {!cards && <rect x={x} y={y + 32} width={width * 0.74} height="2" fill="#d0d7dc" />}
            </g>
          );
        })}
      </svg>
      <figcaption style={{ fontSize: 12, color: "#64747a", marginTop: 6 }}>
        结构示意 · A4 单页
      </figcaption>
    </figure>
  );
}

/** Intentionally a schematic, never a second rendering of a user's content. */
export function StudioTemplateSchematic({ id }: { id: NativeTemplateId }) {
  const featured = featuredStructures[id];
  if (featured) return <FeaturedSchematic id={id} {...featured} />;
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
        aria-label={`${columns ? "宽正文窄侧栏" : research ? "科研单页" : compact ? "紧凑单栏" : "清晰单栏"}结构示意，非当前内容预览`}
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
              精选成果 · 单页
            </text>
          </>
        )}
      </svg>
      <figcaption style={{ fontSize: 12, color: "#64747a", marginTop: 6 }}>结构示意</figcaption>
    </figure>
  );
}
