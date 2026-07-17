import { useEffect, useRef, useState } from "react";

interface CopyLinkButtonProps {
  url: string;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("copy_failed");
  }
}

export function CopyLinkButton({ url }: CopyLinkButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) {
        window.clearTimeout(resetTimer.current);
      }
    },
    [],
  );

  async function handleCopy() {
    try {
      await copyText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }

    if (resetTimer.current !== undefined) {
      window.clearTimeout(resetTimer.current);
    }
    resetTimer.current = window.setTimeout(() => setStatus("idle"), 3_000);
  }

  const label =
    status === "copied" ? "已复制" : status === "failed" ? "复制失败，请手动复制" : "复制官方链接";

  return (
    <>
      <button className="button button--secondary" type="button" onClick={handleCopy}>
        {label}
      </button>
      <output className="sr-only" aria-live="polite">
        {status === "copied" ? "官方岗位链接已复制。" : ""}
        {status === "failed" ? "自动复制失败，请选择链接后手动复制。" : ""}
      </output>
    </>
  );
}
