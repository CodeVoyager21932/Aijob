import { resumeRichPlain, RESUME_TEMPLATE_BY_ID, type ResumeStudioDraft } from '@aijob/contracts';
import { ModalSurface } from '../components/ModalSurface';
function fields(draft: ResumeStudioDraft) {
  const values = new Map<string, string>();
  values.set('简历名称', draft.title);
  values.set('个人信息', [draft.content.basics.name, draft.content.basics.headline, draft.content.basics.phone, draft.content.basics.email, draft.content.basics.city, ...draft.content.basics.links.map((l) => `${l.label} ${l.url}`)].join('\n'));
  const layout = draft.layout;
  values.set('版式', [
    RESUME_TEMPLATE_BY_ID.get(layout.templateKey)?.name ?? '原有模板',
    `${layout.fontFamily === 'serif' ? '宋体' : '黑体'} · ${layout.fontSize} 磅`,
    `行距 ${layout.lineHeight} · 页边距 ${layout.margin} mm`,
    `模块间距 ${layout.sectionGap} · 段距 ${layout.paragraphGap ?? '跟随模板'}`,
    `条目间距 ${layout.entryGap ?? '跟随模板'}`,
    `分栏：${{ auto: '跟随模板', one: '单栏', two: '双栏' }[layout.columns]} · 栏宽 ${Math.round((layout.columnRatio ?? 0.32) * 100)}%`,
    `颜色：${{ ink: '墨黑', green: '青绿', navy: '深蓝' }[layout.accent]}`,
    `${layout.photoVisible === false ? '隐藏照片' : '显示照片'} · ${layout.keepEntriesTogether ? '尽量保持条目完整' : '允许条目续页'}`,
    ...draft.content.sections.map((section) => `${section.title}：${section.column === 'aside' ? '辅助栏' : '主栏'}`),
  ].join('\n'));
  values.set('模块顺序', draft.content.sections.map((s) => `${s.title}${s.hidden ? '（隐藏）' : ''}`).join(' → '));
  for (const section of draft.content.sections) for (const entry of section.entries) {
    values.set(`条目 ${entry.id}`, [section.title,entry.title,entry.organization,entry.role,entry.degree,entry.major,entry.location,entry.startDate,entry.endDate, ...Object.values(entry.details ?? {}), resumeRichPlain(entry.body), entry.hidden ? '（隐藏）' : ''].filter(Boolean).join('\n'));
  }
  return values;
}
export function StudioConflictDialog({ local, remote, busy, close, keep, useServer, copy }: { local: ResumeStudioDraft; remote: ResumeStudioDraft; busy: boolean; close: () => void; keep: () => void; useServer: () => void; copy: () => void }) {
  const a=fields(local), b=fields(remote), differences=[...new Set([...a.keys(),...b.keys()])].filter((key)=>a.get(key)!==b.get(key));
  return <ModalSurface ariaLabel="比较未同步修改" className="sw-tool-modal sw-conflict" closeLabel="继续编辑" onClose={close}>
    <header><h2>比较未同步修改</h2><button type="button" onClick={close}>继续编辑</button></header>
    <p>左侧是这台浏览器中的输入，右侧是服务器版本 {remote.revision}。如果又有新版本，系统会保留输入并提示。</p>
    <div className="sw-conflict-actions"><button type="button" disabled={busy} onClick={copy}>当前输入另存方向稿</button><button type="button" disabled={busy} onClick={keep}>保留当前输入并保存</button><button type="button" disabled={busy} onClick={useServer}>使用右侧版本（可撤销）</button></div>
    {!differences.length&&<p>正文与版式没有差异，可以保留当前输入继续保存。</p>}
    {differences.map((key)=><section key={key}><h3>{key.startsWith('条目 ')?'经历条目':key}</h3><div className="sw-conflict-columns"><div><small>当前输入</small><pre>{a.get(key)||'这一版没有此内容'}</pre></div><div><small>服务器版本</small><pre>{b.get(key)||'这一版没有此内容'}</pre></div></div></section>)}
  </ModalSurface>;
}
