import { z } from 'zod';

export const arrowSchema = z.enum(['→', '↝', '↻']);

export const entrySchema = z.object({
  id: z.string().min(1),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  arrow: arrowSchema,
  text: z.string()
});

export const daySchema = z.array(entrySchema);
