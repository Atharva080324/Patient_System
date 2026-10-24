import { z } from 'zod';

const envSchema = z.object({
  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required')
    .default('mongodb://localhost:27017/patient_dev?replicaSet=rs0'),
  MONGODB_DB: z.string().min(1, 'MONGODB_DB is required').default('patient_dev'),
  APP_URL: z.string().url('APP_URL must be a valid URL').default('http://localhost:3000'),
  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET must be at least 32 characters')
    .default('super_secret_clinical_system_key_32_chars_minimum!'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(240),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  CLINIC_TIMEZONE: z.string().default('Asia/Kolkata'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let parsedEnv: Env | null = null;

export function getEnv(): Env {
  if (parsedEnv) return parsedEnv;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const errorDetails = result.error.format();
    console.error('Invalid environment variables:', JSON.stringify(errorDetails, null, 2));
    throw new Error('Invalid environment variables. Application refusing to start.');
  }

  parsedEnv = result.data;
  return parsedEnv;
}

export const env = getEnv();
