import { BookmarkListSchema,BookmarkSchema,JobSearchResponseSchema,SavedSearchSchema } from "@aijob/contracts";
import { apiRequest,createIdempotencyKey } from "./client";
import { jobSearchPath,type JobFilters } from "./product";
import { recommendationRequestFromFilters } from "../career-os/job-navigation";
export const bookmarkKey=["career-os","bookmarks"] as const;
export const getBookmarks=()=>apiRequest("/v1/bookmarks",{responseSchema:BookmarkListSchema});
export const putBookmark=(jobId:string,saved:boolean,expectedRevision:number,key:string)=>apiRequest(`/v1/bookmarks/${jobId}`,{method:"PUT",body:{saved,expectedRevision},idempotencyKey:key,responseSchema:BookmarkSchema});
export const getBookmarkedJobs=(filters:JobFilters,signal?:AbortSignal)=>apiRequest(jobSearchPath(filters).replace('/v1/jobs?','/v1/bookmarks/jobs?'),{responseSchema:JobSearchResponseSchema,signal});
export function saveCatalogSearch(label:string,filters:JobFilters,key=createIdempotencyKey(),subscription?:{discoveryEnabled:boolean;digestEnabled:boolean;digestTime:string;timezone:"Asia/Shanghai"}){
 const query=recommendationRequestFromFilters(filters).scope;
 return apiRequest('/v1/saved-searches',{method:'POST',body:{label,scope:{cities:[],recruitmentTypes:[],educationLevels:[]},dataset:'public',catalogQuery:{...query,sort:filters.sort??'verified_desc'},...(subscription?{subscription}:{})},idempotencyKey:key,responseSchema:SavedSearchSchema});
}
