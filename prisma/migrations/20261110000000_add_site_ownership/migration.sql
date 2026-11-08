-- Preuve de propriété exigée avant tout scan de sécurité complet.
-- Les sites existants restent non vérifiés : leurs scans s'arrêtent jusqu'à vérification.
ALTER TABLE "Site" ADD COLUMN "ownershipToken" TEXT;
ALTER TABLE "Site" ADD COLUMN "ownershipVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Site" ADD COLUMN "ownershipVerifiedHost" TEXT;
ALTER TABLE "Site" ADD COLUMN "ownershipMethod" TEXT;
