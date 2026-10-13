import { useQuery,useMutation,useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { bookmarkKey,getBookmarks,putBookmark } from "../../api/bookmarks";
import { createIdempotencyKey } from "../../api/client";
export function BookmarkButton({jobId}:{jobId:string}){
 const client=useQueryClient(),query=useQuery({queryKey:bookmarkKey,queryFn:getBookmarks,staleTime:15000}),current=query.data?.items.find(b=>b.jobId===jobId),attempt=useRef<{hash:string;key:string}|null>(null);
 const mutation=useMutation({mutationFn:()=>{const saved=!current?.saved,revision=current?.revision??0,hash=`${jobId}:${saved}:${revision}`;if(attempt.current?.hash!==hash)attempt.current={hash,key:createIdempotencyKey()};return putBookmark(jobId,saved,revision,attempt.current.key);},onSuccess:async()=>{await client.invalidateQueries({queryKey:bookmarkKey});await client.invalidateQueries({queryKey:['career-os','jobs']});},onError:()=>void client.invalidateQueries({queryKey:bookmarkKey}),retry:false});
 return <span className="bookmark-control"><button type="button" className="career-button" aria-pressed={current?.saved??false} disabled={query.isPending||query.isError||mutation.isPending} onClick={()=>mutation.mutate()}>{current?.saved?'★ 已收藏':'☆ 收藏岗位'}</button>{mutation.isError?<span role="alert">{mutation.error.message}<button type="button" onClick={()=>mutation.reset()}>收起</button></span>:null}</span>;
}
