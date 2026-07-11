'use strict';

const {
  getSessionById,
  getMessagesBySession,
  getLastMessageType,
  getLatestDraft,
  createMessage,
  createDraft,
  updateDraftReview,
  incrementRoundCount,
  incrementQuestionCount,
  incrementDeliberationCount,
  resetDeliberationCount,
} = require('../db/db');
const { runDirector } = require('./roles/director');
const { runRequirementsWriter } = require('./roles/requirementsWriter');
const { runReviewer } = require('./roles/reviewer');

const DEFAULT_MAX_INTERNAL_DELIBERATION = 2;

function getMaxInternalDeliberation(env = process.env) {
  const raw = env.MAX_INTERNAL_DELIBERATION || `${DEFAULT_MAX_INTERNAL_DELIBERATION}`;
  const value = Number.parseInt(raw, 10);

  if (Number.isNaN(value) || value < 0) {
    return DEFAULT_MAX_INTERNAL_DELIBERATION;
  }

  return value;
}

function toWriterQuestionText(questions) {
  if (!questions || questions.length === 0) {
    return null;
  }
  return questions.map((q) => `- ${q}`).join('\n');
}

function toReviewerQuestionText(questions) {
  if (!questions || questions.length === 0) {
    return '';
  }
  return questions.map((q) => `- ${q}`).join('\n');
}

function normalizeReviewerVerdict(verdict) {
  if (verdict === 'OK') return 'ok';
  if (verdict === 'QUESTION') return 'question';
  // UNKNOWN 含めて安全側で needs_revision 扱い
  return 'needs_revision';
}

function buildHumanSummary(messages) {
  const humanLines = messages
    .filter((m) => m.role === 'human')
    .map((m) => `- (${m.message_type}) ${m.content}`);

  return humanLines.join('\n');
}

function getLatestQuestionAnswer(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role === 'human' && m.message_type === 'question_answer') {
      return m.content;
    }
  }
  return '';
}

async function runWriterInternalDeliberation({
  session,
  roundNumber,
  directorInstruction,
  currentDraft,
  unresolvedQuestionText,
  runRequirementsWriterFn,
  logger,
}) {
  const maxDelib = getMaxInternalDeliberation();
  let latestResult = null;

  while (true) {
    incrementDeliberationCount(session.id);
    const updatedSession = getSessionById(session.id);

    if (updatedSession.deliberation_count > maxDelib) {
      resetDeliberationCount(session.id);
      return {
        resolved: false,
        askHuman: true,
        questionText: unresolvedQuestionText,
      };
    }

    const messages = getMessagesBySession(session.id);
    const latestAnswer = getLatestQuestionAnswer(messages);

    latestResult = await runRequirementsWriterFn({
      directorInstruction,
      currentDraft,
      internalDeliberationMode: true,
      deliberationContext: [
        `直前の未解決質問:\n${unresolvedQuestionText}`,
        latestAnswer ? `人間の直近回答:\n${latestAnswer}` : '',
      ].filter(Boolean).join('\n\n'),
    });

    createMessage({
      sessionId: session.id,
      role: 'requirements_writer',
      messageType: 'internal_deliberation',
      content: latestResult.rawContent,
      roundNumber,
    });

    if (latestResult.questions.length === 0) {
      resetDeliberationCount(session.id);
      return {
        resolved: true,
        askHuman: false,
        writerResult: latestResult,
      };
    }

    unresolvedQuestionText = toWriterQuestionText(latestResult.questions);
    logger.warn('要件定義役の内部協議で未解決質問が継続', {
      sessionId: session.id,
      deliberationCount: updatedSession.deliberation_count,
    });
  }
}

async function runReviewerInternalDeliberation({
  session,
  roundNumber,
  draftBody,
  unresolvedQuestionText,
  latestHumanInput,
  runReviewerFn,
  logger,
}) {
  const maxDelib = getMaxInternalDeliberation();
  let latestResult = null;

  while (true) {
    incrementDeliberationCount(session.id);
    const updatedSession = getSessionById(session.id);

    if (updatedSession.deliberation_count > maxDelib) {
      resetDeliberationCount(session.id);
      return {
        resolved: false,
        askHuman: true,
        questionText: unresolvedQuestionText,
      };
    }

    const messages = getMessagesBySession(session.id);
    const latestAnswer = getLatestQuestionAnswer(messages);

    latestResult = await runReviewerFn({
      draft: draftBody,
      humanInput: latestHumanInput,
      internalDeliberationMode: true,
      deliberationContext: [
        `直前の未解決質問:\n${unresolvedQuestionText}`,
        latestAnswer ? `人間の直近回答:\n${latestAnswer}` : '',
      ].filter(Boolean).join('\n\n'),
    });

    createMessage({
      sessionId: session.id,
      role: 'reviewer',
      messageType: 'internal_deliberation',
      content: latestResult.rawContent,
      roundNumber,
    });

    if (latestResult.verdict !== 'QUESTION') {
      resetDeliberationCount(session.id);
      return {
        resolved: true,
        askHuman: false,
        reviewerResult: latestResult,
      };
    }

    unresolvedQuestionText = toReviewerQuestionText(latestResult.questions) || latestResult.comment;
    logger.warn('レビュー役の内部協議で未解決質問が継続', {
      sessionId: session.id,
      deliberationCount: updatedSession.deliberation_count,
    });
  }
}

/**
 * 1ラウンド分の3AIオーケストレーションを実行し、messages/drafts/sessionsを更新する。
 * @param {{ sessionId: number, humanInput: string, logger?: Console, deps?: object }} params
 * @returns {Promise<object>}
 */
async function runRound({ sessionId, humanInput, logger = console, deps = {} }) {
  const runDirectorFn = deps.runDirector || runDirector;
  const runRequirementsWriterFn = deps.runRequirementsWriter || runRequirementsWriter;
  const runReviewerFn = deps.runReviewer || runReviewer;

  const session = getSessionById(sessionId);
  if (!session) {
    throw new Error(`セッションが見つかりません: ${sessionId}`);
  }

  const roundNumber = session.round_count + 1;
  const currentDraft = getLatestDraft(sessionId)?.content_markdown || '';
  const messages = getMessagesBySession(sessionId);
  const humanSummary = buildHumanSummary(messages);
  const lastMessageType = getLastMessageType(sessionId);
  const isAfterQuestionAnswer = lastMessageType === 'question_answer';

  const directorResult = await runDirectorFn({
    humanInput,
    currentDraft,
    humanSummary,
  });

  createMessage({
    sessionId,
    role: 'director',
    messageType: 'normal',
    content: directorResult.content,
    roundNumber,
  });

  let writerResult = await runRequirementsWriterFn({
    directorInstruction: directorResult.content,
    currentDraft,
  });

  createMessage({
    sessionId,
    role: 'requirements_writer',
    messageType: 'normal',
    content: writerResult.rawContent,
    roundNumber,
  });

  // 要件定義役から質問が出た場合
  if (writerResult.questions.length > 0) {
    let writerQuestion = toWriterQuestionText(writerResult.questions);

    if (isAfterQuestionAnswer) {
      const delib = await runWriterInternalDeliberation({
        session,
        roundNumber,
        directorInstruction: directorResult.content,
        currentDraft,
        unresolvedQuestionText: writerQuestion,
        runRequirementsWriterFn,
        logger,
      });

      if (delib.resolved) {
        writerResult = delib.writerResult;
      } else {
        const { id: draftId } = createDraft({
          sessionId,
          roundNumber,
          contentMarkdown: writerResult.draftBody,
          writerQuestion: writerQuestion,
        });

        createMessage({
          sessionId,
          role: 'requirements_writer',
          messageType: 'question',
          content: writerQuestion,
          roundNumber,
        });

        incrementQuestionCount(sessionId);

        return {
          sessionId,
          roundNumber,
          nextAction: 'ask_human',
          questionSource: 'requirements_writer',
          questionText: writerQuestion,
          isFollowUpQuestion: true,
          draftId,
        };
      }
    } else {
      const { id: draftId } = createDraft({
        sessionId,
        roundNumber,
        contentMarkdown: writerResult.draftBody,
        writerQuestion: writerQuestion,
      });

      createMessage({
        sessionId,
        role: 'requirements_writer',
        messageType: 'question',
        content: writerQuestion,
        roundNumber,
      });

      incrementQuestionCount(sessionId);

      return {
        sessionId,
        roundNumber,
        nextAction: 'ask_human',
        questionSource: 'requirements_writer',
        questionText: writerQuestion,
        isFollowUpQuestion: false,
        draftId,
      };
    }
  }

  const { id: draftId } = createDraft({
    sessionId,
    roundNumber,
    contentMarkdown: writerResult.draftBody,
    writerQuestion: null,
  });

  let reviewerResult = await runReviewerFn({
    draft: writerResult.draftBody,
    humanInput,
  });

  createMessage({
    sessionId,
    role: 'reviewer',
    messageType: 'normal',
    content: reviewerResult.rawContent,
    roundNumber,
  });

  // レビュー役から質問が出た場合
  if (reviewerResult.verdict === 'QUESTION') {
    let reviewerQuestion = toReviewerQuestionText(reviewerResult.questions) || reviewerResult.comment;

    if (isAfterQuestionAnswer) {
      const delib = await runReviewerInternalDeliberation({
        session,
        roundNumber,
        draftBody: writerResult.draftBody,
        unresolvedQuestionText: reviewerQuestion,
        latestHumanInput: humanInput,
        runReviewerFn,
        logger,
      });

      if (delib.resolved) {
        reviewerResult = delib.reviewerResult;
      } else {
        updateDraftReview(draftId, {
          reviewerVerdict: 'question',
          reviewerComment: reviewerQuestion,
        });

        createMessage({
          sessionId,
          role: 'reviewer',
          messageType: 'question',
          content: reviewerQuestion,
          roundNumber,
        });

        incrementQuestionCount(sessionId);

        return {
          sessionId,
          roundNumber,
          nextAction: 'ask_human',
          questionSource: 'reviewer',
          questionText: reviewerQuestion,
          isFollowUpQuestion: true,
          draftId,
        };
      }
    } else {
      updateDraftReview(draftId, {
        reviewerVerdict: 'question',
        reviewerComment: reviewerQuestion,
      });

      createMessage({
        sessionId,
        role: 'reviewer',
        messageType: 'question',
        content: reviewerQuestion,
        roundNumber,
      });

      incrementQuestionCount(sessionId);

      return {
        sessionId,
        roundNumber,
        nextAction: 'ask_human',
        questionSource: 'reviewer',
        questionText: reviewerQuestion,
        isFollowUpQuestion: false,
        draftId,
      };
    }
  }

  // 通常判定（OK / NEEDS_REVISION / UNKNOWN）
  const normalizedVerdict = normalizeReviewerVerdict(reviewerResult.verdict);
  updateDraftReview(draftId, {
    reviewerVerdict: normalizedVerdict,
    reviewerComment: reviewerResult.comment || null,
  });

  incrementRoundCount(sessionId);

  return {
    sessionId,
    roundNumber,
    nextAction: 'review_result',
    reviewerVerdict: normalizedVerdict,
    reviewerComment: reviewerResult.comment,
    draftId,
  };
}

module.exports = {
  getMaxInternalDeliberation,
  runRound,
};
