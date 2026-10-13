import { paginateResumeStudio, studioV2Html, type ResumeStudioContent, type ResumeStudioLayout } from '@aijob/contracts';
import { studioWebFontCss } from './StudioPagedPreview';

/** Bounded, user-triggered measurement. Never shorten prose, shrink fonts, change
 * template/columns, or remove a deliberate page break to make the result fit. */
export async function fitStudioToOnePage(content: ResumeStudioContent, layout: ResumeStudioLayout, photo?: string): Promise<ResumeStudioLayout | null> {
  const candidates=[
    {lineHeight:1.32,margin:15,sectionGap:9,entryGap:6,paragraphGap:2},
    {lineHeight:1.28,margin:14,sectionGap:8,entryGap:5,paragraphGap:1.5},
    {lineHeight:1.25,margin:13,sectionGap:7,entryGap:4,paragraphGap:1},
  ];
  for(const values of candidates) {
    const candidate={...layout};
    for(const key of ['lineHeight','margin','sectionGap','entryGap','paragraphGap'] as const) candidate[key]=Math.min(layout[key]??values[key],values[key]);
    const frame=document.createElement('iframe');
    frame.title='一页排版测算';frame.setAttribute('sandbox','allow-same-origin');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
    frame.style.cssText='position:fixed;left:-10000px;top:0;width:826px;height:1155px;visibility:hidden;pointer-events:none;border:0';
    try {
      const count=await new Promise<number>((resolve,reject)=>{
        const timer=window.setTimeout(()=>reject(new Error('排版测算超时，当前稿件没有改变。')),12000);
        frame.onload=()=>{void (async()=>{
          try {
            const doc=frame.contentDocument;if(!doc?.querySelector('.rs-document'))return;
            await doc.fonts.ready;
            if(Array.from(doc.fonts).some(face=>face.status==='error')) throw new Error('中文字体尚未加载完成，这次没有改变排版。请恢复连接后重试。');
            await Promise.all(Array.from(doc.images).map(img=>img.decode().catch(()=>{})));
            const result=paginateResumeStudio({root:doc.body,keepEntriesTogether:candidate.keepEntriesTogether,autoColumns:candidate.autoColumns??true});
            window.clearTimeout(timer);resolve(result.pageCount);
          } catch(error){window.clearTimeout(timer);reject(error);}
        })();};
        frame.srcdoc=studioV2Html('一页排版测算',content,candidate,studioWebFontCss(candidate.fontFamily, candidate),photo?{photoDataUrl:photo}:{});
        document.body.append(frame);
      });
      if(count===1)return candidate;
    } finally {frame.onload=null;frame.remove();}
  }
  return null;
}
