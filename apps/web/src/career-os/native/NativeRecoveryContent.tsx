import type {NativeResumeDocument} from "@aijob/resume-core";

const plain=(value:string)=>new DOMParser().parseFromString(value,"text/html").body.textContent??"";
/** Unsaved recovery content is inspected without creating or changing server artifacts. */
export function NativeRecoveryContent({document}:{document:NativeResumeDocument}) {
  const sections=[...Object.entries(document.data.sections).map(([id,section])=>({id,...section})),...document.data.customSections];
  const values=(item:object)=>Object.entries(item).filter(([key,value])=>!["id","icon"].includes(key)&&typeof value==="string"&&value).map(([key,value])=><p key={key} style={{whiteSpace:"pre-wrap"}}>{plain(String(value))}</p>);
  return <article style={{maxHeight:"65vh",overflow:"auto",padding:24,background:"white",color:"#222"}}>
    <p>先核对正文，继续编辑后会显示保存版本的 PDF。</p>
    {values(document.data.basics)}
    {document.data.summary.content?<section><h2>{document.data.summary.title}</h2><p>{plain(document.data.summary.content)}</p></section>:null}
    {sections.filter(section=>section.items.length).map(section=><section key={section.id}><h2>{section.title}</h2>
      {section.items.map(item=><div key={item.id}>{values(item)}</div>)}
    </section>)}
  </article>;
}
