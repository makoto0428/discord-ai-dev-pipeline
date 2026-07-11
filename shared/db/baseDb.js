/**
 * baseDb.js
 * SQLite接続の共通処理。DBファイルのオープンとスキーママイグレーション（CREATE TABLE IF NOT EXISTS）を行う。
 * 各フェーズのdb.jsからこのモジュールを利用する。
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

function loadBetterSqlite3() {
  try {
    return require('better-sqlite3');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }

    const cwdRequire = createRequire(path.resolve(process.cwd(), 'package.json'));
    return cwdRequire('better-sqlite3');
  }
}

const Database = loadBetterSqlite3();

/**
 * SQLiteデータベースを開き、指定されたSQLファイルでマイグレーションを実行する。
 * @param {string} dbPath - DBファイルのパス
 * @param {string} schemaPath - スキーマSQLファイルのパス
 * @returns {import('better-sqlite3').Database}
 */
function openDatabase(dbPath, schemaPath) {
  // DBファイルの親ディレクトリが存在しない場合は作成
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // WALモードで書き込みパフォーマンスを向上
  db.pragma('journal_mode = WAL');
  // 外部キー制約を有効化
  db.pragma('foreign_keys = ON');

  // スキーマの適用（CREATE TABLE IF NOT EXISTS なので冪等）
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  return db;
}

module.exports = { openDatabase };
