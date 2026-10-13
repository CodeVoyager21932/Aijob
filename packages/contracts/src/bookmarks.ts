import { z } from "zod";
export const BookmarkSchema=z.object({jobId:z.string().uuid(),saved:z.boolean(),revision:z.number().int().positive(),updatedAt:z.string().datetime()});
export const BookmarkListSchema=z.object({items:z.array(BookmarkSchema)});
export const PutBookmarkSchema=z.object({saved:z.boolean(),expectedRevision:z.number().int().nonnegative()}).strict();
