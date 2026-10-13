import { z } from "zod";

const identifier = z.string().min(1).max(300);
/** No duplicate resume text is stored in a binding. The original owns source content. */
export const nativeSourceBindingSchema = z.strictObject({
  originalId: identifier,
  blockId: identifier,
  sectionId: identifier,
  itemId: identifier.optional(),
  field: z.string().min(1).max(100),
});
export type NativeSourceBinding = z.infer<typeof nativeSourceBindingSchema>;
