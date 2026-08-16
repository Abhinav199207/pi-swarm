/** Scope pattern matching for memory ACL enforcement. */

export function normalizeScope(scope: string): string {
  return scope.endsWith("/") ? scope : `${scope}/`;
}

export function scopeMatches(pattern: string, scope: string): boolean {
  const normalizedPattern = normalizeScope(pattern);
  const normalizedScope = normalizeScope(scope);
  if (normalizedPattern.endsWith("*/")) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalizedScope.startsWith(prefix);
  }
  return normalizedScope.startsWith(normalizedPattern);
}

export function filterByAllowedScopes<T extends { scope: string }>(
  items: T[],
  allowedPatterns: string[],
): T[] {
  return items.filter((item) => allowedPatterns.some((pattern) => scopeMatches(pattern, item.scope)));
}

export function dedupeStatements<T extends { statement?: string; content?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const text = (item.statement ?? item.content ?? "").trim().toLowerCase();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(item);
  }
  return out;
}
