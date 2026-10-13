import { randomUUID } from 'node:crypto';
import { SetTemplatePreferenceSchema, RESUME_TEMPLATE_BY_ID, supportedResumeTemplate } from '@aijob/contracts';
import type { ResumeStudioLayout } from '@aijob/contracts';
import type { Database } from '@aijob/database';
import { sql, type Kysely, type Transaction } from 'kysely';
import { assertActiveOwnerEpoch, type OwnerScope } from '../identity/session-repository.js';
import { hashCanonicalJson } from '../lib/canonical-json.js';
import { ServiceError } from '../lib/service-error.js';
import { encryptResumePayload, decryptResumePayload } from '../resume/crypto.js';
import { nativeTemplateCatalog } from '@aijob/resume-core';
import { z } from 'zod';
type Db = Kysely<Database> | Transaction<Database>;
export async function templatePreferences(db: Db, owner: OwnerScope) {
  const { rows } = await sql<{template_id:string;favorite:boolean;revision:number;last_used_at:Date|null}>`SELECT * FROM profile.resume_template_preferences WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(db);
  return { items: rows.map((r) => ({ templateId:r.template_id, favorite:r.favorite, revision:Number(r.revision), lastUsedAt:r.last_used_at?.toISOString() ?? null })) };
}
export async function setTemplatePreference(db: Kysely<Database>, owner: OwnerScope, raw: unknown, key: string) {
  return persistTemplatePreference(db, owner, SetTemplatePreferenceSchema.parse(raw), key);
}
export async function nativeTemplatePreferences(db: Db, owner: OwnerScope) {
  const result = await templatePreferences(db, owner);
  return {items: result.items.filter(item => item.templateId.startsWith('native:')).map(item => ({...item,templateId:item.templateId.slice(7)}))};
}
export async function setNativeTemplatePreference(db: Kysely<Database>, owner: OwnerScope, raw: unknown, key: string) {
  const input = z.object({templateId:z.string().refine(id => nativeTemplateCatalog.some(template => template.id === id)),favorite:z.boolean(),expectedRevision:z.number().int().nonnegative()}).strict().parse(raw);
  await persistTemplatePreference(db, owner, {...input,templateId:`native:${input.templateId}`}, `native:${key}`);
  return nativeTemplatePreferences(db, owner);
}
async function persistTemplatePreference(db: Kysely<Database>, owner: OwnerScope, input: {templateId:string;favorite:boolean;expectedRevision:number}, key: string) {
  const hash = hashCanonicalJson(input);
  return db.transaction().execute(async (tx) => {
    await assertActiveOwnerEpoch(tx, owner.ownerId, owner.ownerEpoch);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`template-prefs:${owner.ownerId}`},0))`.execute(tx);
    const replay = (await sql<{request_hash:string;result:unknown}>`SELECT * FROM profile.resume_template_receipts WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND idempotency_key=${key}`.execute(tx)).rows[0];
    if (replay) { if (hash !== replay.request_hash) throw new ServiceError(409,'IDEMPOTENCY_KEY_REUSED','请求编号对应了不同内容。'); return replay.result; }
    const current = (await templatePreferences(tx,owner)).items.find((t) => t.templateId === input.templateId);
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new ServiceError(409,'TEMPLATE_PREFERENCE_CONFLICT','模板收藏已有更新，请刷新后重试。');
    await sql`INSERT INTO profile.resume_template_preferences(owner_id,owner_epoch,template_id,favorite,revision) VALUES(${owner.ownerId},${owner.ownerEpoch},${input.templateId},${input.favorite},1) ON CONFLICT(owner_id,owner_epoch,template_id) DO UPDATE SET favorite=EXCLUDED.favorite,revision=profile.resume_template_preferences.revision+1`.execute(tx);
    const result = await templatePreferences(tx,owner);
    await sql`INSERT INTO profile.resume_template_receipts(owner_id,owner_epoch,idempotency_key,request_hash,result) VALUES(${owner.ownerId},${owner.ownerEpoch},${key},${hash},${JSON.stringify(result)}::jsonb)`.execute(tx);
    return result;
  });
}
export function assertTemplateVersion(layout: ResumeStudioLayout) {
  if (!RESUME_TEMPLATE_BY_ID.has(layout.templateKey)) return;
  if (!supportedResumeTemplate(layout.templateKey, layout.templateVersion, layout.rendererVersion)) throw new ServiceError(409,'RESUME_TEMPLATE_VERSION_UNSUPPORTED','此模板版本尚不受支持，请重新打开模板库；正文仍然保留。');
}
export async function recordTemplateUse(tx: Db, owner: OwnerScope, templateId: string) {
  if (!RESUME_TEMPLATE_BY_ID.has(templateId) && !(templateId.startsWith('native:') && nativeTemplateCatalog.some(item => item.id === templateId.slice(7)))) return;
  await sql`INSERT INTO profile.resume_template_preferences(owner_id,owner_epoch,template_id,last_used_at) VALUES(${owner.ownerId},${owner.ownerEpoch},${templateId},now()) ON CONFLICT(owner_id,owner_epoch,template_id) DO UPDATE SET last_used_at=now()`.execute(tx);
}
export function inspectResumePhoto(buffer: Buffer, mime: string) {
  const fail = () => new ServiceError(422,'RESUME_PHOTO_INVALID','请选择 5 MiB 以内、边长不超过 6000 像素的 JPEG 或 PNG 照片。');
  if (!buffer.length || buffer.length > 5242880) throw fail();
  let width=0,height=0;
  if (mime === 'image/png' && buffer.length >= 33 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.toString('ascii',12,16)==='IHDR') { width=buffer.readUInt32BE(16); height=buffer.readUInt32BE(20); }
  else if (mime === 'image/jpeg' && buffer[0]===255 && buffer[1]===216) {
    let offset=2;
    while (offset+4 < buffer.length) { if(buffer[offset++]!==255) break; while(buffer[offset]===255) offset++; const marker=buffer[offset++]!; if(marker===217||marker===218) break; if(marker===1||marker>=208&&marker<=215) continue; const length=buffer.readUInt16BE(offset); if(length<2||offset+length>buffer.length) break; if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=buffer.readUInt16BE(offset+3);width=buffer.readUInt16BE(offset+5);break;} offset+=length; }
  }
  if(!width||!height||width>6000||height>6000||width*height>16000000) throw fail();
  return {width,height};
}
export async function uploadResumePhoto(db: Kysely<Database>, owner: OwnerScope, buffer: Buffer, mediaType: string, encryptionKey: string, key: string = randomUUID()) {
  const dimensions=inspectResumePhoto(buffer,mediaType), encrypted=encryptResumePayload(buffer,encryptionKey);
  return db.transaction().execute(async(tx)=>{
    await assertActiveOwnerEpoch(tx,owner.ownerId,owner.ownerEpoch);
    const receiptKey=`photo:${key}`, hash=hashCanonicalJson({hash:encrypted.plaintextSha256,mediaType});
    const replay=(await sql<{request_hash:string;result:{id:string}}> `SELECT request_hash,result FROM profile.resume_template_receipts WHERE owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND idempotency_key=${receiptKey}`.execute(tx)).rows[0];
    if(replay){if(replay.request_hash!==hash)throw new ServiceError(409,'IDEMPOTENCY_KEY_REUSED','请求编号对应另一张照片。');const active=(await sql`SELECT id FROM profile.resume_photos WHERE id=${replay.result.id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND deleted_at IS NULL`.execute(tx)).rows[0];if(!active)throw new ServiceError(410,'RESUME_PHOTO_DELETED','照片已删除，原上传请求不会恢复它。');return replay.result;}
    const id=randomUUID();
    const row=(await sql<{id:string}>`INSERT INTO profile.resume_photos(id,owner_id,owner_epoch,media_type,width,height,byte_size,content_hash,ciphertext,nonce,auth_tag) VALUES(${id},${owner.ownerId},${owner.ownerEpoch},${mediaType},${dimensions.width},${dimensions.height},${buffer.length},${encrypted.plaintextSha256},${encrypted.ciphertext},${encrypted.initializationVector},${encrypted.authenticationTag}) ON CONFLICT(owner_id,owner_epoch,content_hash) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,nonce=EXCLUDED.nonce,auth_tag=EXCLUDED.auth_tag,deleted_at=NULL RETURNING id`.execute(tx)).rows[0]!;
    const result={...dimensions,id:row.id,mediaType,byteSize:buffer.length};
    await sql`INSERT INTO profile.resume_template_receipts(owner_id,owner_epoch,idempotency_key,request_hash,result) VALUES(${owner.ownerId},${owner.ownerEpoch},${receiptKey},${hash},${JSON.stringify(result)}::jsonb)`.execute(tx);
    return result;
  });
}
export async function assertPhotoOwner(db: Db, owner: OwnerScope, photoId?: string|null) {
  if(!photoId)return;
  const row=(await sql`SELECT id FROM profile.resume_photos WHERE id=${photoId} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch}`.execute(db)).rows[0];
  if(!row)throw new ServiceError(404,'RESUME_PHOTO_NOT_FOUND','这张照片不存在或不属于当前账号。');
}
export async function readResumePhoto(db: Db, owner: OwnerScope, id: string, encryptionKey: string) {
  const row=(await sql<{media_type:string;ciphertext:Buffer;nonce:Buffer;auth_tag:Buffer}>`SELECT media_type,ciphertext,nonce,auth_tag FROM profile.resume_photos WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND deleted_at IS NULL`.execute(db)).rows[0];
  if(!row)return null;
  return {mediaType:row.media_type,buffer:decryptResumePayload({ciphertext:row.ciphertext,initializationVector:row.nonce,authenticationTag:row.auth_tag},encryptionKey)};
}
export async function deleteResumePhoto(db: Kysely<Database>, owner: OwnerScope, id:string) {
  await db.transaction().execute(async(tx)=>{await assertActiveOwnerEpoch(tx,owner.ownerId,owner.ownerEpoch);await sql`UPDATE profile.resume_photos SET ciphertext=NULL,nonce=NULL,auth_tag=NULL,deleted_at=now() WHERE id=${id} AND owner_id=${owner.ownerId} AND owner_epoch=${owner.ownerEpoch} AND deleted_at IS NULL`.execute(tx);});
  return {deleted:true};
}
