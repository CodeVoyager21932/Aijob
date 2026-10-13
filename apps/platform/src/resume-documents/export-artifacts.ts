import { randomUUID, createHash } from 'node:crypto';
import { type CreateResumeExport, type ResumeExportArtifact, type ResumePrintInput, resumeContentManifest, normalizeResumeOutput } from '@aijob/contracts';
import type { Database } from '@aijob/database';
import { sql, type Kysely, type Transaction } from 'kysely';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';
import { load } from 'cheerio';
import { assertActiveOwnerEpoch, type OwnerScope } from '../identity/session-repository.js';
import { hashCanonicalJson } from '../lib/canonical-json.js';
import { ServiceError } from '../lib/service-error.js';
import { decryptResumePayload, encryptResumePayload } from '../resume/crypto.js';
import { createAtsResumeDocx } from '../resume/export-docx.js';
import { buildResumeDocumentDocxInput, loadResumeExportSnapshot, safeResumeFileName } from './export-service.js';
import { createStudioDocx } from './studio-docx.js';
import { renderResumePdf, type PdfRuntimeConfig } from './pdf-service.js';

type Db = Kysely<Database> | Transaction<Database>;
type Row = {
  id:string; document_id:string; content_revision_id:string; layout_revision_id:string;
  format:'pdf'|'docx'; state:ResumeExportArtifact['state']; file_name:string; media_type:string;
  page_count:number|null; byte_size:number|null; content_hash:string|null;
  template_id:string; template_version:string; renderer_version:string; font_set_version:string;
  created_at:Date; failure_code:string|null; lease_token:string|null; lease_expires_at:Date|null;
  ciphertext:Buffer|null; nonce:Buffer|null; auth_tag:Buffer|null;
};
const summary = (r: Row): ResumeExportArtifact => ({
  id:r.id, documentId:r.document_id, contentRevisionId:r.content_revision_id, layoutRevisionId:r.layout_revision_id,
  format:r.format, state:r.state, fileName:r.file_name, mediaType:r.media_type,
  pageCount:r.page_count, byteSize:r.byte_size, sha256:r.content_hash,
  templateId:r.template_id, templateVersion:r.template_version, rendererVersion:r.renderer_version,
  fontSetVersion:r.font_set_version, createdAt:new Date(r.created_at).toISOString(), failureCode:r.failure_code,
});
const missing = () => new ServiceError(404,'RESUME_EXPORT_NOT_FOUND','这份导出文件不存在、已删除或不属于当前账号。');
async function activeDocument(db: Db, owner: OwnerScope, documentId: string) {
  const row = await db.selectFrom('profile.resume_documents').select('id')
    .where('id','=',documentId).where('owner_id','=',owner.ownerId).where('owner_epoch','=',owner.ownerEpoch)
    .where('deleted_at','is',null).forUpdate().executeTakeFirst();
  if (!row) throw new ServiceError(410,'RESUME_DOCUMENT_DELETED','简历已删除，本次导出不会恢复它。');
}
async function rowById(db: Db, owner: OwnerScope, id: string) {
  return (await sql<Row>`SELECT a.* FROM profile.resume_export_artifacts a JOIN profile.resume_documents d ON d.id=a.document_id AND d.owner_id=a.owner_id
    WHERE a.id=${id} AND a.owner_id=${owner.ownerId} AND a.owner_epoch=${owner.ownerEpoch} AND d.deleted_at IS NULL`.execute(db)).rows[0];
}
export async function getResumeExport(db: Db, owner: OwnerScope, id: string) {
  await assertActiveOwnerEpoch(db,owner.ownerId,owner.ownerEpoch);
  const row = await rowById(db,owner,id); if(!row || row.state==='deleted') throw missing();
  return summary(row);
}
export async function listResumeExports(db: Kysely<Database>, owner: OwnerScope, documentId: string) {
  return db.transaction().execute(async tx => {
    await assertActiveOwnerEpoch(tx,owner.ownerId,owner.ownerEpoch); await activeDocument(tx,owner,documentId);
    const {rows}=await sql<Row>`SELECT * FROM profile.resume_export_artifacts WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND document_id=${documentId} AND purpose='retained' AND state<>'deleted' ORDER BY created_at DESC LIMIT 200`.execute(tx);
    return {items:rows.map(summary)};
  });
}

export type ExportArtifactInput = {
  db:Kysely<Database>; owner:OwnerScope; documentId:string; request:CreateResumeExport;
  idempotencyKey:string; encryptionKey:string; runtime?:PdfRuntimeConfig;
  purpose?: 'preview' | 'retained';
};
/** The renderer has no write capability. This seam also permits deterministic deletion-race tests. */
export type ExportRenderer = (snapshot: ResumePrintInput, format:'pdf'|'docx') => Promise<{buffer:Buffer;pageCount:number|null}>;
export async function renderExportArtifact(input: ExportArtifactInput, snapshot: ResumePrintInput) {
  const manifest = snapshot.studio ? resumeContentManifest(snapshot.studio.content) : undefined;
  const expected = manifest?.fields.map(f=>({id:f.id,value:f.value})) ?? snapshot.content.sections.flatMap(s=>s.blocks.map(b=>({id:b.id,value:b.text})));
  if (input.request.format==='pdf') {
    const buffer=await renderResumePdf({db:input.db,snapshot,...(input.runtime?{runtime:input.runtime}:{})});
    const loading=getDocument({data:new Uint8Array(buffer),useSystemFonts:false});
    const pdf=await loading.promise;
    try {
      // v3 already checks each field at its page coordinates in renderResumePdf.
      // Historical documents have no DOM field annotations, but still get a text completeness check.
      if(snapshot.studio?.layout.rendererVersion!=='studio-pages-v3') {
        const parts:string[]=[];
        for(let p=1;p<=pdf.numPages;p++) for(const item of (await (await pdf.getPage(p)).getTextContent({disableNormalization:true})).items) if('str' in item)parts.push(item.str);
        const actual=normalizeResumeOutput(parts.join(''));
        if(expected.some(f=>!actual.includes(normalizeResumeOutput(f.value)))) throw new ServiceError(422,'RESUME_EXPORT_CONTENT_INCOMPLETE','此历史版式未通过内容检查。可以恢复到当前稿并选用新版模板后导出，原版本仍保留。');
      }
      return {buffer,pageCount:pdf.numPages};
    } finally { await loading.destroy(); }
  }
  const buffer=snapshot.studio ? await createStudioDocx(snapshot.studio.content,snapshot.studio.layout,snapshot.studio.resources) : await createAtsResumeDocx(buildResumeDocumentDocxInput(snapshot));
  const actual=normalizeResumeOutput((await mammoth.extractRawText({buffer})).value);
  const html=load((await mammoth.convertToHtml({buffer})).value), urls=new Set(html('a').map((_,a)=>html(a).attr('href')).get());
  if(expected.some(f=>!actual.includes(normalizeResumeOutput(f.value))) || manifest?.links.some(l=>!urls.has(l.href))) throw new ServiceError(422,'RESUME_EXPORT_CONTENT_INCOMPLETE','DOCX 未通过内容完整性检查。草稿已保留，请重试。');
  return {buffer,pageCount:null}; // Word/WPS choose their own page layout; do not report PDF's page count as DOCX's.
}

export async function createResumeExport(input: ExportArtifactInput, render?: ExportRenderer): Promise<ResumeExportArtifact> {
  return createExportWithAdapter(input, {
    load: (tx) => loadResumeExportSnapshot({db:tx,owner:input.owner,documentId:input.documentId,query:input.request,allowHistorical:true,encryptionKey:input.encryptionKey}),
    describe: (snapshot) => {
      const layout=snapshot.studio?.layout;
      return { title:snapshot.title, versions:{templateId:layout?.templateKey??snapshot.templateKey,templateVersion:layout?.templateVersion??'legacy',rendererVersion:layout?.rendererVersion??'legacy',fontSetVersion:layout?.fontSetVersion??'legacy',manifestVersion:'resume-content-manifest-v1'},
        resources:snapshot.studio?.resources?.photoDataUrl?createHash('sha256').update(snapshot.studio.resources.photoDataUrl).digest('hex'):null };
    },
    render: (snapshot) => render?render(snapshot,input.request.format):renderExportArtifact(input,snapshot),
  });
}

/** Shared lease, owner, receipt and encrypted artifact lifecycle; adapters own document semantics. */
export async function createExportWithAdapter<S>(input: ExportArtifactInput, adapter: {
  load: (tx:Transaction<Database>) => Promise<S>;
  describe: (snapshot:S) => {title:string;versions:{templateId:string;templateVersion:string;rendererVersion:string;fontSetVersion:string;manifestVersion:string};resources:unknown};
  render: (snapshot:S) => Promise<{buffer:Buffer;pageCount:number|null;renderMetadata?:unknown}>;
}): Promise<ResumeExportArtifact> {
  const {db,owner,documentId,request,idempotencyKey}=input;
  const requestHash=hashCanonicalJson({documentId,...request}), token=randomUUID();
  const prepared=await db.transaction().execute(async tx=>{
    await assertActiveOwnerEpoch(tx,owner.ownerId,owner.ownerEpoch);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`resume-export:${owner.ownerId}:${idempotencyKey}`},0))`.execute(tx);
    await activeDocument(tx,owner,documentId);
    const receipt=(await sql<{request_hash:string;artifact_id:string}>`SELECT * FROM profile.resume_export_receipts WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND idempotency_key=${idempotencyKey}`.execute(tx)).rows[0];
    let row:Row|undefined;
    if(receipt) {
      if(receipt.request_hash!==requestHash)throw new ServiceError(409,'IDEMPOTENCY_KEY_REUSED','请求编号对应了另一份导出内容。');
      row=await rowById(tx,owner,receipt.artifact_id);
      if(!row || row.state==='deleted')throw new ServiceError(410,'RESUME_EXPORT_DELETED','这份文件已删除，原请求不会恢复它。需要时请重新导出。');
      if(input.purpose !== 'preview') await retainExportPair(tx, owner, row.id, row.content_revision_id);
      if(row.state==='ready' || row.state==='generating' && row.lease_expires_at && row.lease_expires_at>new Date())return {artifact:summary(row)};
    }
    const snapshot=await adapter.load(tx);
    const {title,versions,resources}=adapter.describe(snapshot);
    const dedupe=hashCanonicalJson({...request,...versions,photo:resources});
    if(!row)row=(await sql<Row>`SELECT * FROM profile.resume_export_artifacts WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND document_id=${documentId} AND dedupe_key=${dedupe} AND state<>'deleted' FOR UPDATE`.execute(tx)).rows[0];
    const id=row?.id??randomUUID(), active=!!row && (row.state==='ready'|| row.state==='generating' && !!row.lease_expires_at && row.lease_expires_at>new Date());
    if(!active) {
      const lifetime=(input.runtime?.timeoutMs??60000)+15000;
      if(row) await sql`UPDATE profile.resume_export_artifacts SET state='generating',lease_token=${token},lease_expires_at=now()+${lifetime}*interval '1 millisecond',expires_at=CASE WHEN purpose='preview' THEN now()+interval '24 hours' ELSE NULL END,failure_code=NULL,updated_at=now() WHERE id=${id}`.execute(tx);
      else await sql`INSERT INTO profile.resume_export_artifacts(id,owner_id,owner_epoch,document_id,content_revision_id,layout_revision_id,format,state,dedupe_key,template_id,template_version,renderer_version,font_set_version,manifest_version,file_name,media_type,lease_token,lease_expires_at,purpose,expires_at)
        VALUES(${id},${owner.ownerId},${owner.ownerEpoch},${documentId},${request.contentRevisionId},${request.layoutRevisionId},${request.format},'generating',${dedupe},${versions.templateId},${versions.templateVersion},${versions.rendererVersion},${versions.fontSetVersion},${versions.manifestVersion},${safeResumeFileName(title,request.format)},${request.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},${token},now()+${lifetime}*interval '1 millisecond',${input.purpose ?? 'retained'},${input.purpose === 'preview' ? sql`now()+interval '24 hours'` : sql`NULL`})`.execute(tx);
    }
    if(input.purpose !== 'preview') await retainExportPair(tx, owner, id, request.contentRevisionId);
    if(!receipt)await sql`INSERT INTO profile.resume_export_receipts(owner_id,owner_epoch,document_id,idempotency_key,request_hash,artifact_id) VALUES(${owner.ownerId},${owner.ownerEpoch},${documentId},${idempotencyKey},${requestHash},${id})`.execute(tx);
    if(active && row)return {artifact:summary(row)};
    return {id,snapshot};
  });
  if(prepared.artifact)return prepared.artifact;
  const {id,snapshot}=prepared;
  try {
    const rendered=await adapter.render(snapshot);
    if(!rendered.buffer.length || rendered.buffer.length>10485760)throw new ServiceError(422,'RESUME_EXPORT_SIZE_INVALID','文件大小不符合导出要求，请检查内容后重试。');
    const encrypted=encryptResumePayload(rendered.buffer,input.encryptionKey);
    return await db.transaction().execute(async tx=>{
      await assertActiveOwnerEpoch(tx,owner.ownerId,owner.ownerEpoch); await activeDocument(tx,owner,documentId);
      const rows=(await sql<Row>`UPDATE profile.resume_export_artifacts SET state='ready',page_count=${rendered.pageCount},byte_size=${rendered.buffer.length},content_hash=${encrypted.plaintextSha256},ciphertext=${encrypted.ciphertext},nonce=${encrypted.initializationVector},auth_tag=${encrypted.authenticationTag},render_metadata=${JSON.stringify(rendered.renderMetadata ?? {})}::jsonb,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND state='generating' AND lease_token=${token} AND lease_expires_at>now() RETURNING *`.execute(tx)).rows;
      if(!rows[0])throw new ServiceError(410,'RESUME_EXPORT_SUPERSEDED','本次生成已取消或被重试替代，草稿保留。');
      return summary(rows[0]);
    });
  } catch(error) {
    const code=error instanceof ServiceError?error.code:'RESUME_EXPORT_FAILED';
    await db.transaction().execute(async tx=>{
      await assertActiveOwnerEpoch(tx,owner.ownerId,owner.ownerEpoch);
      await sql`UPDATE profile.resume_export_artifacts SET state='failed',failure_code=${code},lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND state='generating' AND lease_token=${token}`.execute(tx);
    }).catch(()=>{}); // deletion/owner retirement intentionally prevents this late write too.
    if(error instanceof ServiceError)throw error;
    throw new ServiceError(503,'RESUME_EXPORT_FAILED','文件生成未完成，草稿仍在。请稍后重试。');
  }
}

export async function downloadResumeExport(db: Db, owner: OwnerScope, id:string, encryptionKey:string, options: { preview?: boolean } = {}) {
  await assertActiveOwnerEpoch(db,owner.ownerId,owner.ownerEpoch);
  // Take the retention write before reading bytes, so cleanup cannot remove a downloaded file.
  if (!options.preview) {
    const retained = (await sql<{content_revision_id:string}>`UPDATE profile.resume_export_artifacts SET purpose='retained',expires_at=NULL
      WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND state='ready' RETURNING content_revision_id`.execute(db)).rows[0];
    if (retained) await retainExportPair(db, owner, id, retained.content_revision_id);
  }
  const row=await rowById(db,owner,id);
  if(!row || row.state==='deleted')throw missing();
  if(row.state!=='ready'||!row.ciphertext||!row.nonce||!row.auth_tag)throw new ServiceError(409,'RESUME_EXPORT_NOT_READY','文件尚未生成成功，请返回导出记录重试。');
  const buffer=decryptResumePayload({ciphertext:row.ciphertext,initializationVector:row.nonce,authenticationTag:row.auth_tag},encryptionKey);
  if(createHash('sha256').update(buffer).digest('hex')!==row.content_hash)throw new ServiceError(503,'RESUME_EXPORT_STORAGE_INVALID','保存的文件未通过校验，请重新导出。');
  return {buffer,...summary(row)};
}

async function retainExportPair(db: Db, owner: OwnerScope, artifactId: string, contentRevisionId: string) {
  await sql`UPDATE profile.resume_export_artifacts SET purpose='retained',expires_at=NULL WHERE id=${artifactId}
    AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND state<>'deleted'`.execute(db);
  await sql`UPDATE profile.native_checkpoint_visibility SET retained=true WHERE content_revision_id=${contentRevisionId}
    AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(db);
}

export async function purgeExpiredPreviewArtifacts(db: Kysely<Database>, now = new Date()) {
  const result = await sql`DELETE FROM profile.resume_export_artifacts a
    WHERE a.purpose='preview' AND a.expires_at<=${now} AND a.state<>'generating'
      AND NOT EXISTS(SELECT 1 FROM profile.native_checkpoint_visibility v WHERE v.content_revision_id=a.content_revision_id AND v.retained)
      AND NOT EXISTS(SELECT 1 FROM application.submitted_materials s WHERE s.owner_id=a.owner_id AND s.content_revision_id=a.content_revision_id AND s.layout_revision_id=a.layout_revision_id)`.execute(db);
  return Number(result.numAffectedRows ?? 0);
}
export async function deleteResumeExport(db:Kysely<Database>,owner:OwnerScope,id:string) {
  return db.transaction().execute(async tx=>{
    await assertActiveOwnerEpoch(tx,owner.ownerId,owner.ownerEpoch);
    const row=await rowById(tx,owner,id);if(!row)throw missing();
    await activeDocument(tx,owner,row.document_id);
    await sql`UPDATE profile.resume_export_artifacts SET state='deleted',ciphertext=NULL,nonce=NULL,auth_tag=NULL,lease_token=NULL,lease_expires_at=NULL,deleted_at=now(),updated_at=now() WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND state<>'deleted'`.execute(tx);
    return {deleted:true};
  });
}
