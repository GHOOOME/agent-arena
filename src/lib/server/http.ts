export function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message }, { status });
}

export function parseJsonArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? (value as T[]) : null;
}
