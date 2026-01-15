export declare function generateId(): string;

export interface Logger {
  info: (ctx: any, message?: string) => void;
  error: (ctx: any, message?: string) => void;
  warn: (ctx: any, message?: string) => void;
  debug: (ctx: any, message?: string) => void;
}

export declare function createLogger(namespace: string): Logger;

export declare const logger: {
  info: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
};
