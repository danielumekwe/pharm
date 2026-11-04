export async function register() {
  // The Worker wraps each request in a database transaction; only local Next.js development needs
  // the in-process scheduler and startup initialization.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "development" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startServer } = await import("./lib/server-startup");
    await startServer();
  }
}
