/** Deliberately small version boundary: there are no previously saved v1 fixtures in this repository. */
export function migrateToCurrent(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('JSON должен содержать объект GeoDocument');
  const version = (raw as Record<string, unknown>).schemaVersion;
  if (version !== 2) throw new Error(`Unsupported document version: ${String(version ?? 'missing')}. Поддерживается schemaVersion: 2.`);
  return raw;
}
