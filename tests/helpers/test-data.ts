export function uniqueMarker(entity: 'POST' | 'COMMENT' | 'GROUP'): string {
  const iso = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return ['QA-E2E', entity, iso, suffix].join('-');
}
