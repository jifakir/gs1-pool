export type LogFields = Record<string, unknown>;

export interface AppLogger {
  child(bindings: LogFields): AppLogger;
  debug(fields: LogFields, msg?: string): void;
  info(fields: LogFields, msg?: string): void;
  warn(fields: LogFields, msg?: string): void;
  error(fields: LogFields, msg?: string): void;
}
