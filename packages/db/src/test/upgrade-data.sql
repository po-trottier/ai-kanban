-- Populated v1 deployment. Fake credentials only. Preserve even archived/deleted records.
INSERT INTO boards (id, name, created_at) VALUES ('b', 'Custom facilities', '2026-01-01');
INSERT INTO users (id, email, display_name, role, password_hash, must_change_password, is_active, timezone, theme, created_at)
VALUES ('u', 'system@rivian-kanban.local', 'Custom operator', 'admin', 'saved-password-hash', true, true, 'Europe/Paris', 'dark', '2026-01-01');
INSERT INTO lanes (id, board_id, key, label, position, wip_limit) VALUES ('l', 'b', 'intake', 'Custom intake', 0, 3);
INSERT INTO locations (id, kind, name) VALUES ('site', 'site', 'Custom site');
INSERT INTO locations (id, parent_id, kind, name) VALUES ('room', 'site', 'room', 'Custom room');
INSERT INTO cards (id, board_id, lane_id, position, title, description, priority, reporter_id, assignee_id, location_id, origin, waiting_reason, created_at, updated_at)
VALUES (9000, 'b', 'l', 'a0', 'Existing ticket', 'Keep this description', 'P2', 'u', 'u', 'room', 'web', 'Custom vendor', '2026-01-01', '2026-01-02');
INSERT INTO cards (id, board_id, lane_id, position, title, priority, reporter_id, origin, resolution, archived_at, created_at, updated_at)
VALUES (8999, 'b', 'l', 'a1', 'Archived ticket', 'P3', 'u', 'web', 'completed', '2026-01-02', '2026-01-01', '2026-01-02');
INSERT INTO comments (id, card_id, author_id, body, created_at, updated_at) VALUES ('c', 9000, 'u', 'Existing comment', '2026-01-01', '2026-01-02');
INSERT INTO comments (id, card_id, parent_comment_id, author_id, body, created_at, updated_at, deleted_at)
VALUES ('reply', 9000, 'c', 'u', 'Deleted reply retained for history', '2026-01-01', '2026-01-02', '2026-01-02');
INSERT INTO attachments (id, card_id, filename, mime, bytes, sha256, storage_key, uploaded_by, created_at)
VALUES ('a', 9000, 'manual.pdf', 'application/pdf', 123, 'saved-checksum', 'existing/blob/key', 'u', '2026-01-01');
INSERT INTO card_events (id, card_id, actor_id, actor_kind, event_type, payload, created_at)
VALUES ('e', 9000, 'u', 'user', 'card.created', '{"title":"Existing ticket"}', '2026-01-01');
INSERT INTO tags (id, name) VALUES ('t', 'Custom tag');
INSERT INTO card_tags (card_id, tag_id) VALUES (9000, 't');
INSERT INTO card_watchers (card_id, user_id, created_at) VALUES (9000, 'u', '2026-01-01');
INSERT INTO card_relations (id, from_card_id, to_card_id, type, created_at) VALUES ('r', 9000, 8999, 'related', '2026-01-01');
INSERT INTO filter_presets (id, owner_id, name, filter, shared, created_at, updated_at)
VALUES ('f', 'u', 'Custom filter', '{"q":"saved"}', true, '2026-01-01', '2026-01-02');
INSERT INTO notifications (id, user_id, card_id, actor_id, event_type, comment_id, created_at)
VALUES ('n', 'u', 9000, 'u', 'comment.created', 'c', '2026-01-01');
INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES ('s', 'u', '2026-01-01', '2027-01-01', '2026-01-02');
INSERT INTO service_tokens (id, name, token_hash, role, scope, created_by, created_at)
VALUES ('token', 'Integration', 'saved-token-hash', 'admin', 'read', 'u', '2026-01-01');
INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES ('client', 'Client', '["https://example.com/callback"]', '2026-01-01');
INSERT INTO oauth_authorization_codes (code_hash, client_id, user_id, redirect_uri, resource, scope, code_challenge, code_challenge_method, expires_at)
VALUES ('code', 'client', 'u', 'https://example.com/callback', 'https://example.com', 'read', 'challenge', 'S256', '2027-01-01');
INSERT INTO oauth_access_tokens (id, token_hash, user_id, client_id, scope, resource, expires_at, created_at)
VALUES ('access', 'saved-access-hash', 'u', 'client', 'read', 'https://example.com', '2027-01-01', '2026-01-01');
INSERT INTO oauth_refresh_tokens (id, token_hash, family_id, user_id, client_id, scope, resource, expires_at, created_at)
VALUES ('refresh', 'saved-refresh-hash', 'family', 'u', 'client', 'read', 'https://example.com', '2027-01-01', '2026-01-01');
