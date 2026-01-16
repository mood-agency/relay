import type { Logger } from "pino";

export declare function generateId(): string;

export declare function createLogger(namespace: string): Logger;

export declare const logger: Logger;
