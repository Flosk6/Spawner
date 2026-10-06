-- M2 access: accounts without passwords (invitations, passkeys, GitHub
-- identities), personal API tokens, CLI device logins, share links for the
-- previews and the audit trail. Existing users keep their GitHub login.

-- Users: snake_case columns like the rest of the v1 schema; the "user" role
-- becomes "member".
ALTER TABLE "users" RENAME COLUMN "username" TO "name";
ALTER TABLE "users" RENAME COLUMN "avatarUrl" TO "avatar_url";
ALTER TABLE "users" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "users" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "users" RENAME COLUMN "lastLoginAt" TO "last_login_at";
ALTER TABLE "users"
  ALTER COLUMN "name" SET DATA TYPE VARCHAR(60),
  ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(6),
  ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(6),
  ALTER COLUMN "updated_at" DROP DEFAULT,
  ALTER COLUMN "last_login_at" SET DATA TYPE TIMESTAMPTZ(6),
  ALTER COLUMN "role" SET DEFAULT 'member',
  ALTER COLUMN "role" SET DATA TYPE VARCHAR(10),
  ADD COLUMN "webauthn_id" VARCHAR(64);
UPDATE "users" SET "role" = 'member' WHERE "role" <> 'admin';
CREATE UNIQUE INDEX "users_webauthn_id_key" ON "users"("webauthn_id");

-- GitHub accounts move from users.githubId to identities.
CREATE TABLE "identities" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "subject" VARCHAR(100) NOT NULL,
    "username" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identities_pkey" PRIMARY KEY ("id")
);
INSERT INTO "identities" ("id", "user_id", "provider", "subject", "username", "created_at")
SELECT 'github-' || "id", "id", 'github', "githubId", "name", "created_at" FROM "users";
DROP INDEX "users_githubId_key";
ALTER TABLE "users" DROP COLUMN "githubId";
CREATE INDEX "identities_user_id_idx" ON "identities"("user_id");
CREATE UNIQUE INDEX "identities_provider_subject_key" ON "identities"("provider", "subject");
ALTER TABLE "identities" ADD CONSTRAINT "identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Audit: audit_logs becomes audit_events; the last 90 days are kept.
CREATE TABLE "audit_events" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" INTEGER,
    "actor" VARCHAR(100) NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "target" VARCHAR(200),
    "details" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);
INSERT INTO "audit_events" ("created_at", "user_id", "actor", "action", "details", "ip", "user_agent")
SELECT l."createdAt", l."userId", COALESCE(u."name", 'unknown'), left(lower(l."action"), 50),
       CASE WHEN l."details" IS NULL THEN NULL ELSE to_jsonb(l."details") END,
       left(l."ipAddress", 64), left(l."userAgent", 300)
FROM "audit_logs" l
LEFT JOIN "users" u ON u."id" = l."userId"
WHERE l."createdAt" > now() - interval '90 days'
ORDER BY l."id";
DROP TABLE "audit_logs";
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Environments: the token they were created with, and their last activity.
ALTER TABLE "environments" ADD COLUMN "last_activity_at" TIMESTAMPTZ(6),
ADD COLUMN "token_name" VARCHAR(40);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" VARCHAR(512) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "device_type" VARCHAR(20) NOT NULL,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "role" VARCHAR(10) NOT NULL,
    "note" VARCHAR(100),
    "user_id" INTEGER,
    "created_by_id" INTEGER,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "prefix" VARCHAR(16) NOT NULL,
    "hash" VARCHAR(64) NOT NULL,
    "scopes" TEXT[],
    "project_id" TEXT,
    "expires_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_codes" (
    "id" TEXT NOT NULL,
    "device_code_hash" VARCHAR(64) NOT NULL,
    "user_code" VARCHAR(9) NOT NULL,
    "client_name" VARCHAR(40) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "user_id" INTEGER,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_polled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "created_by_id" INTEGER,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "api_tokens_prefix_key" ON "api_tokens"("prefix");

-- CreateIndex
CREATE INDEX "api_tokens_user_id_idx" ON "api_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_codes_device_code_hash_key" ON "device_codes"("device_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "device_codes_user_code_key" ON "device_codes"("user_code");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");

-- CreateIndex
CREATE INDEX "share_links_environment_id_idx" ON "share_links"("environment_id");

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_codes" ADD CONSTRAINT "device_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
