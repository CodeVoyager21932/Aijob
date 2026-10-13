import { useEffect, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ResumeRichTextSchema, type ResumeRichNode } from "@aijob/contracts";
import { normalizeResumePaste } from './normalize-resume-paste';
export function RichTextField({
  value,
  onChange,
  label,
  onUndo,
  onRedo,
}: {
  value: ResumeRichNode;
  onChange: (value: ResumeRichNode) => void;
  label: string;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const [linkOpen,setLinkOpen]=useState(false),[href,setHref]=useState(""),[linkError,setLinkError]=useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        ...(onUndo ? { undoRedo: false as const } : {}),
        heading: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        link: {
          openOnClick: false,
          protocols: ["http", "https", "mailto", "tel"],
          autolink: false,
        },
      }),
    ],
    content: JSON.parse(JSON.stringify(value)) as JSONContent,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && !event.isComposing) {
          if (event.key.toLowerCase() === 'z' && onUndo) { event.preventDefault(); if (event.shiftKey) onRedo?.(); else onUndo(); return true; }
          if (event.key.toLowerCase() === 'y' && onRedo) { event.preventDefault(); onRedo(); return true; }
        }
        return false;
      },
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        class: "studio-rich-input",
      },
      transformPastedHTML: normalizeResumePaste,
    },
    onUpdate: ({ editor: current }) => {
      const parsed = ResumeRichTextSchema.safeParse(current.getJSON());
      if (parsed.success) onChange(parsed.data);
    },
  });
  useEffect(() => {
    if (editor && JSON.stringify(editor.getJSON()) !== JSON.stringify(value))
      editor.commands.setContent(JSON.parse(JSON.stringify(value)) as JSONContent, {
        emitUpdate: false,
      });
  }, [value, editor]);
  if (!editor) return null;
  return (
    <div className="studio-rich">
      <div className="studio-format-bar" role="toolbar" aria-label={`${label}格式`}>
        <button
          type="button"
          aria-label="加粗"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="斜体"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <em>I</em>
        </button>
        <button
          type="button"
          aria-label="项目列表"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          • 列表
        </button>
        <button type="button" aria-label="下划线" onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
        <button type="button" aria-label="增加列表缩进" disabled={!editor.can().sinkListItem('listItem')} onClick={() => editor.chain().focus().sinkListItem('listItem').run()}>缩进 →</button>
        <button type="button" aria-label="减少列表缩进" disabled={!editor.can().liftListItem('listItem')} onClick={() => editor.chain().focus().liftListItem('listItem').run()}>← 缩进</button>
        <button
          type="button"
          aria-label="编号列表"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1. 列表
        </button>
        <button
          type="button"
          onClick={() => {
            setHref(editor.getAttributes("link").href ?? "https://");setLinkOpen(true);setLinkError("");
          }}
        >
          链接
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          清除格式
        </button>
      </div>
      {linkOpen?<div className="studio-link-editor"><label>链接地址<input aria-label="链接地址" value={href} onChange={(e)=>setHref(e.target.value)} onKeyDown={(e)=>{if(e.key==='Escape'){setLinkOpen(false);editor.commands.focus();}}}/></label><button type="button" onClick={()=>{if(!/^(https?:\/\/|mailto:|tel:)/i.test(href)){setLinkError("请填写网页、邮件或电话链接。");return;}editor.chain().focus().extendMarkRange("link").setLink({href}).run();setLinkOpen(false);}}>应用链接</button><button type="button" onClick={()=>{editor.chain().focus().extendMarkRange("link").unsetLink().run();setLinkOpen(false);}}>移除链接</button><button type="button" onClick={()=>{setLinkOpen(false);editor.commands.focus();}}>取消</button>{linkError?<p role="alert">{linkError}</p>:null}</div>:null}
      <EditorContent editor={editor} />
    </div>
  );
}
