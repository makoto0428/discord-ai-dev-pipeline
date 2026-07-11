/**
 * db.js
 * phase1-requirements-bot 固有のSQLite CRUD関数。
 * sessions / messages / drafts テーブルを操作する。
 */

const path = require('path');
const { openDatabase } = require('../../../shared/db/baseDb');

const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

/** @type {import('better-sqlite3').Database} */
let db;

function resolveDbPath() {
  return process.env.DB_PATH
    ? path.resolve(__dirname, '../../', process.env.DB_PATH)
    : path.resolve(__dirname, '../../data/bot.db');
}

/**
 * DB接続を初期化する（アプリ起動時に1回呼ぶ）。
 */
function initDb() {
  if (db) {
    db.close();
  }

  db = openDatabase(resolveDbPath(), SCHEMA_PATH);
  return db;
}

/**
 * 現在のDB接続を返す（未初期化の場合は自動で初期化する）。
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (!db) initDb();
  return db;
}

/**
 * DB接続をクローズする。
 */
function closeDb() {
  if (!db) {
    return;
  }

  db.close();
  db = undefined;
}

// ─────────────────────────────────────────────
// sessions CRUD
// ─────────────────────────────────────────────

/**
 * 新規セッションを作成する。
 * @param {{ discordChannelId: string, discordUserId: string, initialRequest: string, maxRounds: number }} params
 * @returns {{ id: number }}
 */
function createSession({ discordChannelId, discordUserId, initialRequest, maxRounds }) {
  const stmt = getDb().prepare(`
    INSERT INTO sessions (discord_channel_id, discord_user_id, initial_request, max_rounds)
    VALUES (@discordChannelId, @discordUserId, @initialRequest, @maxRounds)
  `);
  const result = stmt.run({ discordChannelId, discordUserId, initialRequest, maxRounds });
  return { id: result.lastInsertRowid };
}

/**
 * IDでセッションを取得する。
 * @param {number} id
 * @returns {object|undefined}
 */
function getSessionById(id) {
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

/**
 * 進行中セッション（status = 'in_progress'）を1件取得する。
 * @returns {object|undefined}
 */
function getActiveSession() {
  return getDb().prepare("SELECT * FROM sessions WHERE status = 'in_progress' LIMIT 1").get();
}

/**
 * セッションのステータスを更新する。
 * @param {number} id
 * @param {'in_progress'|'confirmed'|'cancelled'|'error'} status
 */
function updateSessionStatus(id, status) {
  getDb().prepare(`
    UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(status, id);
}

/**
 * round_count をインクリメントする。
 * @param {number} id
 */
function incrementRoundCount(id) {
  getDb().prepare(`
    UPDATE sessions SET round_count = round_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(id);
}

/**
 * question_count をインクリメントし、deliberation_count を 0 にリセットする。
 * @param {number} id
 */
function incrementQuestionCount(id) {
  getDb().prepare(`
    UPDATE sessions
    SET question_count = question_count + 1,
        deliberation_count = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);
}

/**
 * deliberation_count をインクリメントする。
 * @param {number} id
 */
function incrementDeliberationCount(id) {
  getDb().prepare(`
    UPDATE sessions SET deliberation_count = deliberation_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(id);
}

/**
 * deliberation_count を 0 にリセットする。
 * @param {number} id
 */
function resetDeliberationCount(id) {
  getDb().prepare(`
    UPDATE sessions SET deliberation_count = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(id);
}

// ─────────────────────────────────────────────
// messages CRUD
// ─────────────────────────────────────────────

/**
 * メッセージを保存する。
 * @param {{ sessionId: number, role: string, messageType: string, content: string, roundNumber: number }} params
 * @returns {{ id: number }}
 */
function createMessage({ sessionId, role, messageType = 'normal', content, roundNumber }) {
  const stmt = getDb().prepare(`
    INSERT INTO messages (session_id, role, message_type, content, round_number)
    VALUES (@sessionId, @role, @messageType, @content, @roundNumber)
  `);
  const result = stmt.run({ sessionId, role, messageType, content, roundNumber });
  return { id: result.lastInsertRowid };
}

/**
 * セッションIDに紐づくメッセージ一覧を時系列順で返す。
 * @param {number} sessionId
 * @returns {object[]}
 */
function getMessagesBySession(sessionId) {
  return getDb().prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC').all(sessionId);
}

/**
 * セッションの直近N件のメッセージを返す。
 * @param {number} sessionId
 * @param {number} limit
 * @returns {object[]}
 */
function getRecentMessages(sessionId, limit = 20) {
  return getDb().prepare(`
    SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?
  `).all(sessionId, limit).reverse();
}

/**
 * セッションの最後のメッセージのmessage_typeを返す。
 * @param {number} sessionId
 * @returns {string|undefined}
 */
function getLastMessageType(sessionId) {
  const row = getDb().prepare(`
    SELECT message_type FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1
  `).get(sessionId);
  return row?.message_type;
}

// ─────────────────────────────────────────────
// drafts CRUD
// ─────────────────────────────────────────────

/**
 * ドラフトを保存する。
 * @param {{ sessionId: number, roundNumber: number, contentMarkdown: string, writerQuestion?: string|null }} params
 * @returns {{ id: number }}
 */
function createDraft({ sessionId, roundNumber, contentMarkdown, writerQuestion = null }) {
  const stmt = getDb().prepare(`
    INSERT INTO drafts (session_id, round_number, content_markdown, writer_question)
    VALUES (@sessionId, @roundNumber, @contentMarkdown, @writerQuestion)
  `);
  const result = stmt.run({ sessionId, roundNumber, contentMarkdown, writerQuestion });
  return { id: result.lastInsertRowid };
}

/**
 * ドラフトのレビュー結果を更新する。
 * @param {number} id
 * @param {{ reviewerVerdict: string, reviewerComment?: string|null }} params
 */
function updateDraftReview(id, { reviewerVerdict, reviewerComment = null }) {
  getDb().prepare(`
    UPDATE drafts SET reviewer_verdict = ?, reviewer_comment = ? WHERE id = ?
  `).run(reviewerVerdict, reviewerComment, id);
}

/**
 * セッションの最新ドラフトを返す。
 * @param {number} sessionId
 * @returns {object|undefined}
 */
function getLatestDraft(sessionId) {
  return getDb().prepare(`
    SELECT * FROM drafts WHERE session_id = ? ORDER BY id DESC LIMIT 1
  `).get(sessionId);
}

/**
 * セッションIDに紐づくドラフト一覧を返す。
 * @param {number} sessionId
 * @returns {object[]}
 */
function getDraftsBySession(sessionId) {
  return getDb().prepare('SELECT * FROM drafts WHERE session_id = ? ORDER BY id ASC').all(sessionId);
}

module.exports = {
  initDb,
  getDb,
  closeDb,
  // sessions
  createSession,
  getSessionById,
  getActiveSession,
  updateSessionStatus,
  incrementRoundCount,
  incrementQuestionCount,
  incrementDeliberationCount,
  resetDeliberationCount,
  // messages
  createMessage,
  getMessagesBySession,
  getRecentMessages,
  getLastMessageType,
  // drafts
  createDraft,
  updateDraftReview,
  getLatestDraft,
  getDraftsBySession,
};
