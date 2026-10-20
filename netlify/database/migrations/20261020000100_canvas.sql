CREATE TABLE canvas_projects (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    revision INTEGER NOT NULL,
    name TEXT NOT NULL,
    object_key TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    invites TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX canvas_projects_owner ON canvas_projects(owner);
CREATE TABLE canvas_jobs (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    payload TEXT NOT NULL,
    expires BIGINT NOT NULL
);
CREATE INDEX canvas_jobs_owner ON canvas_jobs(owner);
CREATE TABLE canvas_limits (
    id TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    expires BIGINT NOT NULL
);
