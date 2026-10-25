import { clock } from './clock';

const REDACTED_KEYS = new Set([
  'name',
  'patientname',
  'doctorname',
  'phone',
  'mobilenumber',
  'mobile',
  'address',
  'medicalhistory',
  'conditions',
  'allergies',
  'currentmedications',
  'token',
  'password',
  'passwordhash',
  'pin',
  'kioskpin',
  'cookie',
  'cookies',
  'authorization',
  'totpsecret',
  'recoverycodes',
  'chiefcomplaint',
  'diagnosis',
  'findings',
  'procedurerecords',
  'casesheet',
  'secret',
  'signature',
  'encryptedsecret',
  'contactname',
  'contactphone',
  'search',
  'q',
  'searchterm',
  'query',
  'searchname',
  'exportdata',
]);

export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Redact 10-digit phone patterns in raw strings
    if (/\b[6-9]\d{9}\b/.test(obj)) {
      return '[REDACTED_PHONE]';
    }
    // Redact search terms in URLs like /api/patients?q=Secret
    if (/[?&](?:q|search|searchTerm)=([^&]+)/i.test(obj)) {
      return obj.replace(/([?&](?:q|search|searchTerm)=)([^&]+)/gi, '$1[REDACTED]');
    }
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (REDACTED_KEYS.has(lowerKey)) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactSensitiveData(value);
    }
  }

  return redacted;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface StructuredLog {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export class Logger {
  private formatLog(level: LogLevel, message: string, meta?: Record<string, unknown>): StructuredLog {
    const cleanMeta = meta ? (redactSensitiveData(meta) as Record<string, unknown>) : {};
    return {
      timestamp: clock.now().toISOString(),
      level,
      message,
      ...cleanMeta,
    };
  }

  info(message: string, meta?: Record<string, unknown>): StructuredLog {
    const entry = this.formatLog('info', message, meta);
    console.log(JSON.stringify(entry));
    return entry;
  }

  warn(message: string, meta?: Record<string, unknown>): StructuredLog {
    const entry = this.formatLog('warn', message, meta);
    console.warn(JSON.stringify(entry));
    return entry;
  }

  error(message: string, meta?: Record<string, unknown>): StructuredLog {
    const entry = this.formatLog('error', message, meta);
    console.error(JSON.stringify(entry));
    return entry;
  }

  debug(message: string, meta?: Record<string, unknown>): StructuredLog {
    const entry = this.formatLog('debug', message, meta);
    if (process.env.NODE_ENV !== 'production') {
      console.debug(JSON.stringify(entry));
    }
    return entry;
  }
}

export const logger = new Logger();
