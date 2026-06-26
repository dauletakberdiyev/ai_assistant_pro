export type StructuredLogger = {
  info: (context: object, message?: string) => void;
  warn: (context: object, message?: string) => void;
  error: (context: object, message?: string) => void;
  debug?: (context: object, message?: string) => void;
};

function write(level: string, context: object, message?: string) {
  const payload = JSON.stringify({
    level,
    msg: message,
    ...context
  });
  if (level === "error") {
    console.error(payload);
    return;
  }
  console.log(payload);
}

export const consoleStructuredLogger: StructuredLogger = {
  info: (context, message) => write("info", context, message),
  warn: (context, message) => write("warn", context, message),
  error: (context, message) => write("error", context, message),
  debug: (context, message) => write("debug", context, message)
};

export function errorContext(error: unknown) {
  return error instanceof Error
    ? { error: error.message, stack: error.stack }
    : { error: String(error) };
}
