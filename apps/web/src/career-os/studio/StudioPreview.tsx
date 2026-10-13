import { useEffect, useRef, useState } from "react";
export function StudioPreview({ html }: { html: string }) {
  const host = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLIFrameElement>(null),
    [width, setWidth] = useState(400),
    [height, setHeight] = useState(1200);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(1, Math.max(0.1, width / 850));
  return (
    <div ref={host} className="studio-preview-viewport">
      <div style={{ height: height * scale, width: "100%", position: "relative" }}>
        <iframe
          ref={frame}
          title="简历实时排版预览"
          srcDoc={html}
          sandbox="allow-same-origin"
          onLoad={() => {
            const doc = frame.current?.contentDocument;
            if (doc) setHeight(Math.max(1200, doc.body.scrollHeight + 32));
          }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 850,
            height,
            border: 0,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
    </div>
  );
}
