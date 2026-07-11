'use strict';

const { getSessionById, getLatestDraft, updateSessionStatus } = require('../db/db');
const { exportRequirementsMarkdown } = require('../output/markdownExporter');

/**
 * セッションの終了条件を判定する。
 * reviewerがOK、または最大ラウンド到達で完了扱い。
 * @param {{ sessionId: number, roundResult: object }} params
 * @returns {{ isComplete: boolean, reason: 'review_ok'|'max_rounds'|null, session: object }}
 */
function checkCompletion({ sessionId, roundResult }) {
  const session = getSessionById(sessionId);

  if (!session) {
    throw new Error(`セッションが見つかりません: ${sessionId}`);
  }

  if (roundResult?.nextAction !== 'review_result') {
    return { isComplete: false, reason: null, session };
  }

  if (roundResult.reviewerVerdict === 'ok') {
    return { isComplete: true, reason: 'review_ok', session };
  }

  if (session.round_count >= session.max_rounds) {
    return { isComplete: true, reason: 'max_rounds', session };
  }

  return { isComplete: false, reason: null, session };
}

/**
 * セッションを確定し、最終ドラフトをMarkdownとして保存する。
 * @param {{ sessionId: number, reason: 'review_ok'|'max_rounds'|'human_ok', logger?: Console }} params
 * @returns {{ sessionId: number, outputPath: string, reason: string, finalDraftId: number }}
 */
function finalizeSession({ sessionId, reason, logger = console }) {
  const session = getSessionById(sessionId);

  if (!session) {
    throw new Error(`セッションが見つかりません: ${sessionId}`);
  }

  const latestDraft = getLatestDraft(sessionId);
  if (!latestDraft) {
    throw new Error(`最終ドラフトが見つかりません: sessionId=${sessionId}`);
  }

  const outputPath = exportRequirementsMarkdown({
    session,
    draft: latestDraft,
    reason,
  });

  updateSessionStatus(sessionId, 'confirmed');

  logger.info('セッションを確定しました', {
    sessionId,
    reason,
    outputPath,
  });

  return {
    sessionId,
    outputPath,
    reason,
    finalDraftId: latestDraft.id,
  };
}

module.exports = {
  checkCompletion,
  finalizeSession,
};
