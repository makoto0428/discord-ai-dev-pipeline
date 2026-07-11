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

const LEVEL_PRIORITIES = {
  [LEVELS.DEBUG]: 10,
  [LEVELS.INFO]: 20,
  [LEVELS.WARN]: 30,
  [LEVELS.ERROR]: 40,
};

function normalizeLevel(input) {
  const value = `${input || ''}`.toUpperCase();
  if (LEVEL_PRIORITIES[value]) {
    return value;
  }
  return LEVELS.INFO;
}

function getCurrentLevel() {
  return normalizeLevel(process.env.LOG_LEVEL);
}

function shouldLog(level) {
  return LEVEL_PRIORITIES[level] >= LEVEL_PRIORITIES[getCurrentLevel()];
}

function serializeMeta(meta) {
  if (meta instanceof Error) {
    return {
      name: meta.name,
      message: meta.message,
      stack: meta.stack,
    };
  }
  return meta;
}

/**
 * タイムスタンプ付きでコンソールへ出力する
 * @param {string} level
 * @param {string} message
 * @param {unknown} [meta]
 */
function log(level, message, meta) {
  if (!shouldLog(level)) {
    return;
  }

  const ts = new Date().toISOString();
  const base = `[${ts}] [${level}] ${message}`;
  const serializedMeta = serializeMeta(meta);

  const printer = level === LEVELS.ERROR
    ? console.error
    : level === LEVELS.WARN
      ? console.warn
      : console.log;

  if (serializedMeta !== undefined) {
    printer(base, serializedMeta);
  } else {
    printer(base);
  }
}

const logger = {
  debug: (msg, meta) => log(LEVELS.DEBUG, msg, meta),
  info:  (msg, meta) => log(LEVELS.INFO,  msg, meta),
  warn:  (msg, meta) => log(LEVELS.WARN,  msg, meta),
  error: (msg, meta) => log(LEVELS.ERROR, msg, meta),
};

module.exports = logger;
