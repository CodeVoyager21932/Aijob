import { useEffect,useState } from 'react';
import type { ResumeExportArtifact } from '@aijob/contracts';
import { apiDownload } from '../../api/client';
import { downloadStudioFile } from '../../api/resume-studio';
import { ModalSurface } from '../components/ModalSurface';
export function StudioExportViewer({artifact,close}:{artifact:ResumeExportArtifact;close:()=>void}) {
  const [url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    let active=true,local='';
    void apiDownload(`/v1/resume-exports/${artifact.id}/file`).then(file=>{
      if(!active)return;local=URL.createObjectURL(file.blob);setUrl(local);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:'文件暂时无法读取');});
    return()=>{active=false;if(local)URL.revokeObjectURL(local);};
  },[artifact.id]);
  return <ModalSurface ariaLabel="已生成的 PDF" className="sw-export-viewer" closeLabel="返回编辑" onClose={close}>
    <header><div><h2>{artifact.fileName}</h2><p>{artifact.pageCount} 页 · {new Date(artifact.createdAt).toLocaleString('zh-CN')} · 下载与此处为同一份文件</p></div>
      <button type="button" onClick={()=>void downloadStudioFile(`/v1/resume-exports/${artifact.id}/file`,artifact.fileName).catch(e=>setError(String(e)))}>下载这份 PDF</button><button type="button" onClick={close}>返回编辑</button></header>
    {error?<p role="alert">{error}</p>:url?<iframe src={url} title={artifact.fileName}/>:<output>正在读取已保存的 PDF…</output>}
  </ModalSurface>;
}
