import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { normalizeResumePaste } from "../studio/normalize-resume-paste";
export function NativeText({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState("");
  const callback = useRef(change);
  callback.current = change;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        undoRedo: false,
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: false },
      }),
    ],
    content: value,
    onUpdate: ({ editor: instance }) => callback.current(instance.getHTML()),
    editorProps: {
      attributes: { role: "textbox", "aria-label": label, "aria-multiline": "true" },
      transformPastedHTML: normalizeResumePaste,
    },
  });
  const marks = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      ordered: current?.isActive("orderedList") ?? false,
      bullet: current?.isActive("bulletList") ?? false,
      link: current?.isActive("link") ?? false,
    }),
  });
  useEffect(() => {
    if (editor && editor.getHTML() !== value)
      editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);
  return (
    <div className="native-rich">
      <span>{label}</span>
      <div role="toolbar" aria-label={`${label}文字格式`}>
        <button
          type="button"
          aria-label="加粗"
          title="加粗"
          aria-pressed={marks?.bold ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="斜体"
          title="斜体"
          aria-pressed={marks?.italic ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label="下划线"
          title="下划线"
          aria-pressed={marks?.underline ?? false}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <u>U</u>
        </button>
        <button
          type="button"
          aria-label="编号列表"
          title="编号列表"
          aria-pressed={marks?.ordered ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          1. 列表
        </button>
        <button
          type="button"
          aria-label="要点列表"
          title="要点列表"
          aria-pressed={marks?.bullet ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          • 列表
        </button>
        <button
          type="button"
          aria-pressed={marks?.link ?? false}
          onClick={() => {
            setLinkValue(String(editor?.getAttributes("link").href ?? ""));
            setLinkError("");
            setLinkOpen((value) => !value);
          }}
        >
          链接
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          清除格式
        </button>
      </div>
      {linkOpen && (
        <div className="native-link-editor">
          <label>
            链接地址
            <input
              aria-label={`${label}链接地址`}
              value={linkValue}
              onChange={(event) => setLinkValue(event.target.value)}
              placeholder="https://"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const href = linkValue.trim();
              if (href && !/^(https?:\/\/|mailto:|tel:)/i.test(href)) {
                setLinkError("请填写完整的 https:// 链接，或邮箱、电话链接。");
                return;
              }
              if (href) editor?.chain().focus().extendMarkRange("link").setLink({ href }).run();
              else editor?.chain().focus().unsetLink().run();
              setLinkOpen(false);
            }}
          >
            保存链接
          </button>
          <button type="button" onClick={() => setLinkOpen(false)}>
            取消
          </button>
          {linkError && <p role="alert">{linkError}</p>}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
