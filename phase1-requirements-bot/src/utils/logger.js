/**
 * logger.js
 * シンプルなコンソールロガー。将来的にファイル出力や外部ロギングサービスへの移行を想定し、
 * console を直接呼ばず、このモジュールを経由する形に統一する。
 */

const LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

/**
 * タイムスタンプ付きでコンソールへ出力する
 * @param {string} level
 * @param {string} message
 * @param {unknown} [meta]
 */
function log(level, message, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level}] ${message}`;
  if (meta !== undefined) {
    console.log(base, meta);
  } else {
    console.log(base);
  }
}

const logger = {
  debug: (msg, meta) => log(LEVELS.DEBUG, msg, meta),
  info:  (msg, meta) => log(LEVELS.INFO,  msg, meta),
  warn:  (msg, meta) => log(LEVELS.WARN,  msg, meta),
  error: (msg, meta) => log(LEVELS.ERROR, msg, meta),
};

module.exports = logger;
