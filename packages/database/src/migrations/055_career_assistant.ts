import { sql, type Migration } from "kysely";
export const careerAssistantMigration:Migration={
  async up(db){
    await sql`
      ALTER TABLE profile.resume_documents ADD COLUMN studio_creation_hash text;
      CREATE TABLE profile.assistant_sessions (
        id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES identity.owners(id),owner_epoch bigint NOT NULL,
        task text NOT NULL CHECK(task IN ('experience','resume_review','interview','job_explanation','expression')),
        title text NOT NULL,pace text NOT NULL CHECK(pace IN ('guided','simulation')),status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
        context jsonb NOT NULL,snapshot jsonb NOT NULL,options jsonb NOT NULL,document_id uuid,
        revision integer NOT NULL DEFAULT 1,creation_key text NOT NULL,creation_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(owner_id,id),UNIQUE(owner_id,creation_key),FOREIGN KEY(owner_id,document_id) REFERENCES profile.resume_documents(owner_id,id) ON DELETE CASCADE
      );
      CREATE TABLE profile.assistant_turns (
        id uuid PRIMARY KEY,owner_id uuid NOT NULL,owner_epoch bigint NOT NULL,session_id uuid NOT NULL,
        ordinal integer NOT NULL,user_message text NOT NULL,intent text NOT NULL,question_id uuid,
        status text NOT NULL CHECK(status IN ('queued','completed','failed','fixed')),result jsonb,failure_code text,model text,
        prompt_version text NOT NULL,output_version text NOT NULL,input_hash text NOT NULL,input_snapshot jsonb NOT NULL,mode text NOT NULL,
        idempotency_key text NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
        UNIQUE(owner_id,id),UNIQUE(owner_id,session_id,ordinal),UNIQUE(owner_id,session_id,idempotency_key),
        FOREIGN KEY(owner_id,session_id) REFERENCES profile.assistant_sessions(owner_id,id) ON DELETE CASCADE,
        FOREIGN KEY(owner_id,question_id) REFERENCES profile.assistant_turns(owner_id,id)
      );
      CREATE TABLE profile.assistant_adoptions (
        owner_id uuid NOT NULL,owner_epoch bigint NOT NULL,turn_id uuid NOT NULL,
        idempotency_key text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(owner_id,idempotency_key),UNIQUE(owner_id,turn_id,request_hash),FOREIGN KEY(owner_id,turn_id) REFERENCES profile.assistant_turns(owner_id,id) ON DELETE CASCADE
      );
      CREATE INDEX assistant_sessions_owner ON profile.assistant_sessions(owner_id,owner_epoch,updated_at DESC);
      CREATE INDEX assistant_turns_session ON profile.assistant_turns(owner_id,session_id,ordinal);
      CREATE TRIGGER assistant_session_epoch BEFORE INSERT OR UPDATE ON profile.assistant_sessions FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      CREATE TRIGGER assistant_turn_epoch BEFORE INSERT OR UPDATE ON profile.assistant_turns FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      CREATE TRIGGER assistant_adoption_epoch BEFORE INSERT ON profile.assistant_adoptions FOR EACH ROW EXECUTE FUNCTION application.assert_planner_owner_epoch();
      GRANT SELECT,INSERT,UPDATE,DELETE ON profile.assistant_sessions,profile.assistant_turns,profile.assistant_adoptions TO aijob_web_api,aijob_match_worker,aijob_ops_cli;
      GRANT ALL ON profile.assistant_sessions,profile.assistant_turns,profile.assistant_adoptions TO aijob_migrator;
      ALTER TABLE matching.personal_ai_calls DROP CONSTRAINT personal_ai_calls_purpose_check,ADD CONSTRAINT personal_ai_calls_purpose_check CHECK(purpose IN ('resume_review','resume_tailoring','experience','interview','job_explanation','expression'));
      ALTER TABLE task_queue.tasks DROP CONSTRAINT tasks_task_type_check, ADD CONSTRAINT tasks_task_type_check CHECK(task_type IN ('crawl','resume_analysis','match_run','recommendation_run','resume_tailoring','resume_export','resume_review','resume_review_v2','owner_deletion','resume_studio_import','career_assistant'));
    `.execute(db);
  },
  async down(){throw new Error("Forward-only: preserve user conversations and adopted material history.");},
};
