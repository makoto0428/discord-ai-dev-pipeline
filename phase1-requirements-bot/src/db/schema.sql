-- sessions テーブル
-- セッション（1回の要件定義対話）の状態を管理する。
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_channel_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
    -- 'in_progress' | 'confirmed' | 'cancelled' | 'error'
  round_count INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  deliberation_count INTEGER NOT NULL DEFAULT 0,
  initial_request TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- messages テーブル
-- 3AI間および人間とのやりとりの生ログ。
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
    -- 'human' | 'director' | 'requirements_writer' | 'reviewer'
  message_type TEXT NOT NULL DEFAULT 'normal',
    -- 'normal' | 'question' | 'question_answer' | 'internal_deliberation'
  content TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- drafts テーブル
-- 各ラウンド時点での要件定義ドラフトとレビュー結果。
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  round_number INTEGER NOT NULL,
  content_markdown TEXT NOT NULL,
  writer_question TEXT,
  reviewer_verdict TEXT,
    -- 'ok' | 'needs_revision' | 'question' | NULL
  reviewer_comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
