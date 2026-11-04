-- Document bytes for deployments without Cloudflare R2 (e.g. Vercel). Additive only.
CREATE TABLE IF NOT EXISTS "regulatory_files" (
    "stored_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "regulatory_files_pkey" PRIMARY KEY ("stored_name")
);
