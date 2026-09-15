CREATE TABLE "board_defaults" (
	"scope" text NOT NULL,
	"subject" text NOT NULL,
	"board_id" text NOT NULL,
	CONSTRAINT "board_defaults_scope_subject_pk" PRIMARY KEY("scope","subject")
);
--> statement-breakpoint
ALTER TABLE "board_defaults" ADD CONSTRAINT "board_defaults_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;