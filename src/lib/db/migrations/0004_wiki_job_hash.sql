-- P14-02: 내용 해시 기반 중복 방지. 기존 DB는 runMigrations의 ALTER로도 보강된다.
ALTER TABLE wiki_jobs ADD COLUMN content_hash TEXT;
