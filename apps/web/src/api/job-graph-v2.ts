import { GraphDirectionsSchema, GraphEvidenceV2Schema, GraphV2Schema, JOB_SEMANTICS_V2, PersonalGraphComparisonSchema, type JobGraphScope } from '@aijob/contracts';
import { apiRequest } from './client';
export type GraphDataset = 'public' | 'private';
export const graphV2Key = ['career-os', 'graph-v2'] as const;
const path = (dataset: GraphDataset) => `/v2/${dataset === 'private' ? 'private-job-graph' : 'job-graph'}`;
export function directionsV2(scope: JobGraphScope, dataset: GraphDataset, signal?: AbortSignal) {
  return apiRequest(`${path(dataset)}/directions?${new URLSearchParams({ scope: JSON.stringify(scope) })}`, { signal, responseSchema: GraphDirectionsSchema });
}
export function graphV2(scope: JobGraphScope, dataset: GraphDataset, signal?: AbortSignal) {
  return apiRequest(`${path(dataset)}?${new URLSearchParams({ scope: JSON.stringify(scope) })}`, { signal, responseSchema: GraphV2Schema });
}
export function graphEvidenceV2(scope: JobGraphScope, dataset: GraphDataset, key: string, offset: number, signal?: AbortSignal) {
  return apiRequest(`${path(dataset)}/evidence?${new URLSearchParams({ scope: JSON.stringify(scope), key, offset: String(offset), limit: '15' })}`, { signal, responseSchema: GraphEvidenceV2Schema });
}
export function compareExperienceV2(scope: JobGraphScope, dataset: GraphDataset, key: string) {
  return apiRequest('/v2/job-graph/personal-comparison', { method: 'POST', body: { scope, dataset, key, extractionVersion: JOB_SEMANTICS_V2 }, responseSchema: PersonalGraphComparisonSchema });
}
