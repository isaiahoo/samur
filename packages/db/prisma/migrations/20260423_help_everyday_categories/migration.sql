-- Extend HelpCategory with everyday (non-emergency) values so the mutual-aid
-- board can host regular neighbourly asks alongside flood-crisis coordination.
-- Ordering follows the enum declaration in schema.prisma; Postgres preserves
-- definition order for sort/cmp on enum values.
ALTER TYPE "HelpCategory" ADD VALUE IF NOT EXISTS 'childcare';
ALTER TYPE "HelpCategory" ADD VALUE IF NOT EXISTS 'petcare';
ALTER TYPE "HelpCategory" ADD VALUE IF NOT EXISTS 'tutoring';
ALTER TYPE "HelpCategory" ADD VALUE IF NOT EXISTS 'errands';
ALTER TYPE "HelpCategory" ADD VALUE IF NOT EXISTS 'repair';
ALTER TYPE "HelpCategory" ADD VALUE IF NOT EXISTS 'giveaway';
ALTER TYPE "HelpCategory" ADD VALUE IF NOT EXISTS 'other';
