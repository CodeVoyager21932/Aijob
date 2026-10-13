import { type Migration, sql } from "kysely";

export const graphExperienceLinksMigration: Migration = {
  async up(db) {
    await sql`
      ALTER TABLE application.planner_items ADD COLUMN source_experience_ids jsonb NOT NULL DEFAULT '[]'
        CHECK(jsonb_typeof(source_experience_ids)='array' AND jsonb_array_length(source_experience_ids)<=50);
      CREATE FUNCTION application.validate_planner_experiences() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(NEW.source_experience_ids) AS link(id)
          WHERE NOT EXISTS (SELECT 1 FROM profile.experiences e WHERE e.id=link.id::uuid AND e.owner_id=NEW.owner_id AND e.owner_epoch=NEW.owner_epoch)
        ) THEN RAISE EXCEPTION 'EXPERIENCE_NOT_FOUND'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER planner_experience_references BEFORE INSERT OR UPDATE OF source_experience_ids ON application.planner_items
        FOR EACH ROW EXECUTE FUNCTION application.validate_planner_experiences();
      CREATE INDEX planner_experience_links ON application.planner_items USING gin(source_experience_ids);
      CREATE FUNCTION application.detach_deleted_experience() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
      BEGIN
        UPDATE application.planner_items SET source_experience_ids=source_experience_ids-OLD.id::text,
          revision=revision+1, updated_at=now()
          WHERE owner_id=OLD.owner_id AND owner_epoch=OLD.owner_epoch AND source_experience_ids ? OLD.id::text;
        UPDATE application.planner_mutation_receipts SET result=jsonb_set(result,'{sourceExperienceIds}',(result->'sourceExperienceIds')-OLD.id::text)
          WHERE owner_id=OLD.owner_id AND owner_epoch=OLD.owner_epoch AND (result->'sourceExperienceIds') ? OLD.id::text;
        RETURN OLD;
      END $$;
      REVOKE ALL ON FUNCTION application.detach_deleted_experience() FROM PUBLIC;
      CREATE TRIGGER detach_planner_experience BEFORE DELETE ON profile.experiences FOR EACH ROW EXECUTE FUNCTION application.detach_deleted_experience();
    `.execute(db);
  },
  async down() {
    throw new Error("Forward-only: keep preparation and experience relationships.");
  },
};
