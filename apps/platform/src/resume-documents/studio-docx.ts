import {
  type ResumeRichNode,
  type ResumeStudioContent,
  ResumeStudioContentSchema,
  type ResumeStudioLayout,
  ResumeStudioLayoutSchema,
  type ResumeStudioSection,
  resumeRichPlain,
  resumeStudioPageGroups,
  resumeStudioUsesTwoColumns,
  usesStudioPagesV2, studioV2Template, studioV2Columns, resumeEntryDetails, resumeEntryHasContent, hasRenderableResumeEntry,
  RESUME_PROFILE_BY_ID,
} from "@aijob/contracts";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  ExternalHyperlink,
  type INumberingOptions,
  type IParagraphOptions,
  type ISectionOptions,
  LevelFormat,
  Packer,
  Paragraph,
  type ParagraphChild,
  SectionType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";

const paragraphKeepsNext = new WeakMap<Paragraph, boolean>();
function flowParagraph(options: IParagraphOptions): Paragraph {
  const paragraph = new Paragraph(options);
  paragraphKeepsNext.set(paragraph, options.keepNext === true);
  return paragraph;
}
function inline(n: ResumeRichNode): ParagraphChild[] {
  if (n.type === "hardBreak") return [new TextRun({ break: 1 })];
  if (n.type !== "text") return (n.content ?? []).flatMap(inline);
  const run = new TextRun({
    text: n.text ?? "",
    bold: n.marks?.some((m) => m.type === "bold") ?? false,
    italics: n.marks?.some((m) => m.type === "italic") ?? false,
    ...(n.marks?.some((m) => m.type === "underline") ? { underline: {} } : {}),
  });
  const link = n.marks?.find((m) => m.type === "link")?.attrs?.href;
  return link && /^(https?:\/\/|mailto:|tel:)/i.test(link)
    ? [new ExternalHyperlink({ link, children: [run] })]
    : [run];
}

function richParagraphs(
  root: ResumeRichNode,
  numbering: INumberingOptions["config"] extends readonly (infer T)[] ? T[] : never,
  keepTogether: boolean,
  paragraphGap = 2.75,
): Paragraph[] {
  const visit = (node: ResumeRichNode, level = 0): IParagraphOptions[] => {
    if (node.type === "paragraph") return [{ children: inline(node), spacing: { after: Math.round(paragraphGap * 20) } }];
    if (node.type === "bulletList" || node.type === "orderedList") {
      const reference = `studio-list-${numbering.length}`;
      const depth = Math.min(level, 8);
      numbering.push({
        reference,
        levels: [
          {
            level: depth,
            format: node.type === "orderedList" ? LevelFormat.DECIMAL : LevelFormat.BULLET,
            text: node.type === "orderedList" ? `%${depth + 1}.` : "•",
            start: node.attrs?.start ?? 1,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 300 + depth * 250, hanging: 200 } } },
          },
        ],
      });
      return (node.content ?? []).flatMap((item) => {
        let first = true;
        return (item.content ?? []).flatMap((child) => {
          if (child.type === "paragraph") {
            const numbered = first;
            first = false;
            return [
              {
                children: inline(child),
                spacing: { after: Math.round(paragraphGap * 20) },
                ...(numbered
                  ? { numbering: { reference, level: depth } }
                  : { indent: { left: 300 + depth * 250 } }),
              },
            ];
          }
          return visit(child, depth + 1);
        });
      });
    }
    return (node.content ?? []).flatMap((child) => visit(child, level));
  };
  const paragraphs = visit(root);
  return paragraphs.map(
    (options, index) =>
      flowParagraph({
        ...options,
        keepNext: keepTogether && index < paragraphs.length - 1,
        keepLines: keepTogether,
      }),
  );
}

export async function createStudioDocx(
  rawContent: ResumeStudioContent,
  rawLayout: ResumeStudioLayout,
  resources?: { photoDataUrl?: string | undefined },
) {
  const content = ResumeStudioContentSchema.parse(rawContent);
  const layout = ResumeStudioLayoutSchema.parse(rawLayout);
  const v2 = usesStudioPagesV2(layout), template = studioV2Template(layout);
  const v3 = layout.rendererVersion === "studio-pages-v3", role = layout.typography;
  const profile=v3?RESUME_PROFILE_BY_ID.get(layout.templateKey):undefined;
  const entryHasContent = v3 ? hasRenderableResumeEntry : resumeEntryHasContent;
  const b = content.basics,
    twips = (n: number) => Math.round(n * 56.6929);
  const font = layout.fontFamily === "serif" ? "SimSun" : "Microsoft YaHei";
  const numbering: { reference: string; levels: import("docx").ILevelsOptions[] }[] = [];
  const color = v3 && layout.colorHex ? layout.colorHex.slice(1) : { ink: "172320", green: "245d4f", navy: "213952" }[layout.accent];
  const headerAlignment =
    layout.templateKey === "cn_classic_single_column" || v2 && ['center','center-photo','stacked-center','classic-group'].includes(template.header) ? AlignmentType.CENTER : AlignmentType.LEFT;
  const header: Paragraph[] = [
    new Paragraph({
      alignment: headerAlignment,
      children: [
        new TextRun({
          text: b.name,
          bold: profile?.id !== 'rendercv_engineering',
          size: v3 && role ? role.namePt * 2 : layout.templateKey === "cn_compact_technical" ? 42 : 52,
          ...(v3 ? {color} : {}),
        }),
      ],
      spacing: { after: 100 },
    }),
  ];
  let photoParagraph: Paragraph | undefined;
  if (resources?.photoDataUrl && layout.photoVisible !== false && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(resources.photoDataUrl)) {
    const [metadata,bytes] = resources.photoDataUrl.split(',');
    photoParagraph=new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ImageRun({ type: metadata!.includes('png') ? 'png' : 'jpg', data: Buffer.from(bytes!, 'base64'), transformation: { width: 66, height: 84 }, altText: { title: '简历照片', description: '本人照片', name: 'photo' } })] });
  }
  if (b.headline)
    header.push(
      new Paragraph({ alignment: headerAlignment, children:[new TextRun({text:b.headline,...(v3&&role?{size:role.contactPt*2}:{})})], spacing: { after: 80 } }),
    );
  const contacts: ParagraphChild[] = [];
  for (const text of [b.phone, b.email, b.city].filter(Boolean)) {
    if (contacts.length) contacts.push(new TextRun(" · "));
    contacts.push(new TextRun({text,...(v3&&role?{size:role.contactPt*2}:{})}));
  }
  for (const link of b.links) {
    if (contacts.length) contacts.push(new TextRun(" · "));
    contacts.push(
      /^(https?:\/\/|mailto:|tel:)/i.test(link.url) ? new ExternalHyperlink({
        link: link.url,
        children: [new TextRun({ text: link.label || link.url, underline: {} })],
      }) : new TextRun([link.label,link.url].filter(Boolean).join(" ")),
    );
  }
  header.push(
    new Paragraph({
      alignment: headerAlignment,
      children: contacts,
      ...(!v3||['jp_classic','jp_ats','jp_academic','jp_scientist','jp_swiss'].includes(template.id)?{border: { bottom: { style: BorderStyle.SINGLE, size: 8, color } }}:{}),
      spacing: { after: layout.sectionGap * 20 },
    }),
  );
  const two = v2 ? studioV2Columns(layout) : resumeStudioUsesTwoColumns(layout);
  const width = twips(210 - layout.margin * 2),
    gap = v3?twips(layout.regions!.gapMm):400;
  const emptyBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const photoWidth=1500;
  const headerContent: (Paragraph | Table)[] = photoParagraph ? [new Table({
    width:{size:width,type:WidthType.DXA},columnWidths:[width-photoWidth,photoWidth],layout:TableLayoutType.FIXED,
    borders:{top:emptyBorder,bottom:emptyBorder,left:emptyBorder,right:emptyBorder,insideHorizontal:emptyBorder,insideVertical:emptyBorder},
    rows:[new TableRow({cantSplit:true,children:[new TableCell({width:{size:width-photoWidth,type:WidthType.DXA},margins:{left:0,right:100,top:0,bottom:0},children:header}),new TableCell({width:{size:photoWidth,type:WidthType.DXA},margins:{left:0,right:0,top:0,bottom:0},children:[photoParagraph]})]})],
  }),new Paragraph({children:[new TextRun({text:'',size:2})],spacing:{before:0,after:0,line:20},keepNext:false})] : header;
  const explicitColumns = content.sections.some((s) => !s.hidden && s.column === 'aside');
  const visible = content.sections.filter((s) => !s.hidden && (!v2 || s.entries.some((e) => !e.hidden && entryHasContent(e)))).map((s) => v2 && two && layout.autoColumns !== false && !explicitColumns ? { ...s, column: (['skills','languages','certificates','awards'].includes(s.kind) ? 'aside' : 'main') as 'main' | 'aside' } : s);
  const assigned = two && (v3 || visible.some((s) => s.column === "aside"));
  const sectionParagraphs = (sections: ResumeStudioSection[], columnWidth: number): Paragraph[] =>
    sections.flatMap((section) => {
      const result: Paragraph[] = [
        flowParagraph({
          children: [
            new TextRun({ text: section.title, bold: true, size: (v3 && role ? role.headingPt : layout.fontSize + 1) * 2, ...(v3 ? {color} : {}) }),
          ],
          keepNext: true,
          pageBreakBefore: section.pageBreakBefore,
          ...(layout.templateKey !== "cn_research_multi_page" && (!v3||!['plain','geometric','triangle'].includes(template.section))
            ? { border: { bottom: { style: v2 && template.section === 'double-rule' ? BorderStyle.DOUBLE : BorderStyle.SINGLE, color: v2 ? color : "BEC9C4", size: v2 && ['thick-rule','accent'].includes(template.section) ? 12 : 4 } } }
            : {}),
          spacing: { before: layout.sectionGap * 20, after: 90 },
          ...(v2 && ['highlight','boxed','square','ribbon'].includes(template.section) ? { shading: { fill: 'EDF1EF' }, indent: { left: 100 } } : {}),
          ...(v2 && template.id === 'rx_kakuna' ? { alignment: AlignmentType.CENTER } : {}),
        }),
      ];
      for (const entry of section.entries.filter((e) => !e.hidden && (!v2 || entryHasContent(e)))) {
        const date = [entry.startDate, entry.endDate].filter(Boolean).join(" — ");
        if(v3&&['skills','languages','certificates','awards'].includes(section.kind)){
          const lead=[entry.title,entry.organization,entry.role,entry.degree,entry.major,entry.location,date].filter(Boolean).join(' · ');
          const details=resumeEntryDetails(entry);
          const first=entry.body.content?.[0];
          const children:ParagraphChild[]=[...(lead?[new TextRun({text:lead+'：',bold:true})]:[])];
          for(const detail of details){children.push(new TextRun({text:detail.label+'：',bold:true}));children.push(...(detail.key==='url'&&/^(https?:\/\/|mailto:|tel:)/i.test(detail.value)?[new ExternalHyperlink({link:detail.value,children:[new TextRun({text:detail.value,underline:{}})]})]:[new TextRun(detail.value)]),new TextRun('； '));}
          if(first?.type==='paragraph')children.push(...inline(first));
          // Short skill/certificate paragraphs travel together; a one-line tail
          // must not become an otherwise empty final page in Word/WPS.
          const compactLength=lead.length+details.reduce((n,d)=>n+d.value.length,0)+resumeRichPlain(entry.body).length;
          result.push(flowParagraph({children,pageBreakBefore:entry.pageBreakBefore,keepNext:false,keepLines:compactLength<300,widowControl:true,spacing:{after:(layout.entryGap??6)*20}}));
          const remaining=first?.type==='paragraph'?entry.body.content!.slice(1):entry.body.content??[];
          result.push(...richParagraphs({type:'doc',content:remaining},numbering,false,layout.paragraphGap??2));
          continue;
        }
        const narrow = columnWidth < twips(125) || v2 && ['stack','below'].includes(template.entry);
        const roleFirst=v3&&['role-inline','role-stack','date-gutter'].includes(template.entry);
        const primary=roleFirst?(section.kind==='education'?[entry.degree,entry.major,entry.title]:['work','internship'].includes(section.kind)?[entry.role,entry.title]:[entry.title]):[entry.title,entry.organization];
        let title=primary.filter(Boolean).join(' · ');
        let meta=(roleFirst?[entry.organization,...(section.kind==='education'?[entry.role]:['work','internship'].includes(section.kind)?[entry.degree,entry.major]:[entry.role,entry.degree,entry.major]),entry.location]:[entry.role,entry.degree,entry.major,entry.location]).filter(Boolean).join(' · ');
        if(v3&&template.entry==='role-inline'){title=[title,meta].filter(Boolean).join(' · ');meta='';}
        result.push(
          flowParagraph({
            children: [
              new TextRun({
                text: title,
                bold: true,
                ...(v3&&role?{size:role.entryPt*2}:{}),
              }),
              ...(!narrow && date ? [new TextRun({text:`\t${date}`,...(v3&&role?{size:role.datePt*2}:{})})] : []),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: columnWidth }],
            keepNext: true,
            pageBreakBefore: entry.pageBreakBefore,
          }),
        );
        if (narrow && date)
          result.push(flowParagraph({ text: date, keepNext: true, spacing: { after: 30 } }));
        if (meta) result.push(flowParagraph({ children:[new TextRun({text:meta,...(profile?.id==='billryan_cn'?{italics:true}:{})})], keepNext: true }));
        for (const detail of resumeEntryDetails(entry)) result.push(flowParagraph({ children: [new TextRun({ text: `${detail.label}：`, bold: true }), ...(detail.key === 'url' && /^(https?:\/\/|mailto:|tel:)/i.test(detail.value) ? [new ExternalHyperlink({ link: detail.value, children: [new TextRun({text:detail.value,underline:{}})] })] : [new TextRun(detail.value)])], spacing: { after: (layout.paragraphGap ?? 3) * 20 }, keepNext: detail.value.length < 180 }));
        const unitsPerLine = columnWidth / 20 / (layout.fontSize * 0.5);
        const estimatedLines = resumeRichPlain(entry.body)
          .split("\n")
          .reduce(
            (sum, line) =>
              sum +
              Math.max(
                1,
                Math.ceil(
                  [...line].reduce(
                    (length, char) => length + ((char.codePointAt(0) ?? 0) > 255 ? 2 : 1),
                    0,
                  ) / unitsPerLine,
                ),
              ),
            0,
          );
        const fitsPage =
          estimatedLines * (layout.fontSize * layout.lineHeight + 3) + 60 <
          ((297 - layout.margin * 2) * 72) / 25.4;
        result.push(
          ...richParagraphs(entry.body, numbering, layout.keepEntriesTogether && fitsPage && estimatedLines < 14,v3?layout.paragraphGap??2:2.75),
        );
        if (!resumeRichPlain(entry.body).trim()) result.push(flowParagraph({ text:'', keepNext:false, spacing:{before:0,after:0,line:1} }));
      }
      return result;
    });
  const page = {
    size: { width: twips(210), height: twips(297) },
    margin: {
      top: twips(v3 ? layout.regions!.marginYmm : layout.margin),
      bottom: twips(v3 ? layout.regions!.marginYmm : layout.margin),
      left: twips(layout.margin),
      right: twips(layout.margin),
    },
  };
  let sections: ISectionOptions[];
  // Keep table rows bounded. WPS moves a single page-spanning row to a fresh page
  // before splitting it, leaving the preceding heading page mostly empty.
  const paragraphChunks=(paragraphs:Paragraph[])=>{
    const chunks:Paragraph[][]=[];
    let chunk:Paragraph[]=[];
    for(const paragraph of paragraphs){
      chunk.push(paragraph);
      // End rows only at a real paragraph boundary. A trailing keepNext in either
      // cell chains the following rows together in Word/WPS and strands the header.
      if(chunk.length>=4&&!paragraphKeepsNext.get(paragraph)){chunks.push(chunk);chunk=[];}
    }
    if(chunk.length)chunks.push(chunk);
    return chunks;
  };
  if(v2 && (template.id==='rx_bronzor'||v3&&template.section==='rail') && layout.columns==='auto'){
    const ratio=v3?twips(27)/width:layout.columnRatio??.31, widths=[Math.round(width*ratio),Math.round(width*(1-ratio))];
    const noBorder={style:BorderStyle.NONE,size:0,color:'FFFFFF'};
    sections=resumeStudioPageGroups(visible).map((group,index)=>({properties:{page,...(index?{type:SectionType.NEXT_PAGE}:{})},children:[...(index?[]:headerContent),...group.map((section)=>{
      const paragraphs=sectionParagraphs([section],widths[1]!-gap/2);
      const chunks=paragraphChunks(paragraphs.slice(1));
      if(!chunks.length)chunks.push([new Paragraph('')]);
      return new Table({width:{size:width,type:WidthType.DXA},columnWidths:widths,layout:TableLayoutType.FIXED,borders:{top:{style:BorderStyle.SINGLE,size:6,color},bottom:noBorder,left:noBorder,right:noBorder,insideHorizontal:noBorder,insideVertical:noBorder},rows:chunks.map((chunk,chunkIndex)=>new TableRow({cantSplit:false,children:[new TableCell({width:{size:widths[0]!,type:WidthType.DXA},children:[chunkIndex?new Paragraph(''):paragraphs[0]??new Paragraph(section.title)]}),new TableCell({width:{size:widths[1]!,type:WidthType.DXA},children:chunk})]}))});
    })]}));
  } else if (assigned) {
    const ratio = layout.columnRatio ?? .31;
    const order = v2 && template.columns === 'left' ? ['aside','main'] as const : ['main','aside'] as const;
    const widths = order.map((c) => Math.round(width * (c === 'aside' ? ratio : 1-ratio)));
    const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    const groups = resumeStudioPageGroups(visible);
    sections = groups.map((group, groupIndex) => {
      const headerColumn=v3&&profile?.header==='sidebar'?'aside':v3&&profile?.header==='main-title'?'main':undefined;
      const columns=order.map((column,index)=>{
        const paragraphs=sectionParagraphs(group.filter(s=>s.column===column),(widths[index]??width/2)-gap/2);
        const mainPhoto=profile?.id==='rx_chikorita';
        const intro=groupIndex===0&&headerColumn===column?[...(photoParagraph&&(column==='aside'||mainPhoto)?[photoParagraph]:[]),...header]:groupIndex===0&&headerColumn==='main'&&column==='aside'&&photoParagraph&&!mainPhoto?[photoParagraph]:[];
        return paragraphChunks([...intro,...paragraphs]);
      });
      const rows=Array.from({length:Math.max(1,...columns.map(c=>c.length))},(_,rowIndex)=>new TableRow({cantSplit:false,children:order.map((column,index)=>new TableCell({
        ...(v2 && column === 'aside' && ['rx_glalie','rx_gengar','rx_chikorita'].includes(template.id) ? { shading: { fill: 'EDF1EF' } } : {}),
        width:{size:widths[index]??width/2,type:WidthType.DXA},margins:{top:0,bottom:0,left:index?gap/2:0,right:index?0:gap/2},children:columns[index]?.[rowIndex]??[new Paragraph('')],
      }))}));
      return {
        properties: { page, ...(groupIndex ? { type: SectionType.NEXT_PAGE } : {}) },
        children: [
          ...(groupIndex || headerColumn ? [] : headerContent),
          ...rows.flatMap((row) => [new Table({
            width: { size: width, type: WidthType.DXA },
            columnWidths: widths,
            layout: TableLayoutType.FIXED,
            borders: {
              top: noBorder,
              bottom: noBorder,
              left: noBorder,
              right: noBorder,
              insideHorizontal: noBorder,
              insideVertical: noBorder,
            },
            rows: [row],
          }), new Paragraph({ children: [new TextRun({ text: '', size: 2 })], keepNext: false, keepLines: false, spacing: { before: 0, after: 0, line: 1 } })]),
        ],
      };
    });
  } else if (two) {
    // The personal heading stays full-width; only resume modules use newspaper columns.
    sections = [
      { properties: { page }, children: headerContent },
      ...resumeStudioPageGroups(visible).map((group, index) => ({
        properties: {
          page,
          type: index ? SectionType.NEXT_PAGE : SectionType.CONTINUOUS,
          column: { count: 2, space: gap },
        },
        children: sectionParagraphs(group, Math.round((width - gap) / 2)),
      })),
      // A terminating continuous section makes Word balance the final pair of columns.
      {
        properties: { page, type: SectionType.CONTINUOUS, column: { count: 1 } },
        children: [
          new Paragraph({
            spacing: { before: 0, after: 0, line: 20 },
            children: [new TextRun({ text: "", size: 2 })],
          }),
        ],
      },
    ];
  } else
    sections = [
      { properties: { page }, children: [...headerContent, ...sectionParagraphs(visible, width)] },
    ];
  return Packer.toBuffer(
    new Document({
      creator: "Aijob",
      numbering: { config: numbering },
      styles: {
        default: {
          document: {
            run: { font, size: layout.fontSize * 2, color: v3 ? "30363D" : color },
            paragraph: {
              spacing: { line: Math.round(240 * layout.lineHeight) },
            },
          },
        },
      },
      sections,
    }),
  );
}
