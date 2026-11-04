/**
 * Bump when the shape of in-memory demo data changes. The dev server keeps data on globalThis
 * across hot reloads; a new version makes it reseed instead of serving records in an old shape.
 */
export const DATA_VERSION = 5;
