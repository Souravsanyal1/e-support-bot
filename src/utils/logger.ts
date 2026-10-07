import { sanitizeLogString } from '../config/env.config';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

interface LogPayload {
  level: LogLevel;
  timestamp: string;
  message: string;
  meta?: Record<string, unknown>;
}

class Logger {
  private formatOutput(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
    const payload: LogPayload = {
      level,
      timestamp: new Date().toISOString(),
      message: sanitizeLogString(message),
    };

    if (meta && Object.keys(meta).length > 0) {
      const sanitizedMeta: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(meta)) {
        // Redact any sensitive field names directly
        if (/token|key|secret|password|auth|credential/i.test(key)) {
          sanitizedMeta[key] = '[REDACTED]';
        } else if (typeof value === 'string') {
          sanitizedMeta[key] = sanitizeLogString(value);
        } else if (value instanceof Error) {
          sanitizedMeta[key] = {
            name: value.name,
            message: sanitizeLogString(value.message),
            stack: sanitizeLogString(value.stack || ''),
          };
        } else {
          try {
            sanitizedMeta[key] = JSON.parse(sanitizeLogString(JSON.stringify(value)));
          } catch {
            sanitizedMeta[key] = String(value);
          }
        }
      }
      payload.meta = sanitizedMeta;
    }

    return JSON.stringify(payload);
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    if (process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development') {
      console.debug(this.formatOutput('DEBUG', message, meta));
    }
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    console.log(this.formatOutput('INFO', message, meta));
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(this.formatOutput('WARN', message, meta));
  }

  public error(message: string, error?: unknown, meta?: Record<string, unknown>): void {
    const errorMeta: Record<string, unknown> = { ...(meta || {}) };

    if (error instanceof Error) {
      errorMeta.errorName = error.name;
      errorMeta.errorMessage = sanitizeLogString(error.message);
      errorMeta.stack = sanitizeLogString(error.stack || '');
    } else if (error !== undefined) {
      errorMeta.rawError = sanitizeLogString(String(error));
    }

    console.error(this.formatOutput('ERROR', message, errorMeta));
  }
}

export const logger = new Logger();
