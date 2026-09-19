import 'server-only';
import { z } from 'zod';

const schema = z.object({
  GEMINI_API_KEY: z.string().min(1).optional(),
  AUTOBIDDER_DATA_DIR: z.string().default('.data/autobidder'),
});

export type ServerEnv = z.infer<typeof schema>;

let cache: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cache) {
    return cache;
  }
  cache = schema.parse({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    AUTOBIDDER_DATA_DIR: process.env.AUTOBIDDER_DATA_DIR,
  });
  return cache;
}
