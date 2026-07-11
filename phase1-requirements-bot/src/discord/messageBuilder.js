'use strict';

const { AttachmentBuilder } = require('discord.js');

const DISCORD_MAX_MESSAGE_LENGTH = 2000;

function normalizeLineBreaks(text) {
  return `${text || ''}`.replace(/\r\n/g, '\n');
}

function splitLongText(text, maxLength = DISCORD_MAX_MESSAGE_LENGTH) {
  const normalized = normalizeLineBreaks(text);

  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const chunks = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength);
    const lineBreakIndex = candidate.lastIndexOf('\n');
    const splitAt = lineBreakIndex > 0 ? lineBreakIndex : maxLength;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function roleToLabel(role) {
  if (role === 'director') return '指示役';
  if (role === 'requirements_writer') return '要件定義役';
  if (role === 'reviewer') return 'レビュー役';
  return role;
}

function trimForSummary(text, max = 320) {
  const normalized = normalizeLineBreaks(text).trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

function buildDraftSummary(draftMarkdown) {
  const normalized = normalizeLineBreaks(draftMarkdown);
  const headings = normalized
    .split('\n')
    .filter((line) => /^#{1,3}\s+/.test(line.trim()))
    .slice(0, 6);

  if (headings.length > 0) {
    return headings.join('\n');
  }

  return trimForSummary(normalized, 240);
}

async function postLongText(channel, text, options = {}) {
  const {
    prefix = '',
    forceFile = false,
    fileName = 'message.md',
  } = options;

  const normalized = normalizeLineBreaks(text).trim();
  const results = [];

  if (forceFile) {
    const file = new AttachmentBuilder(Buffer.from(normalized, 'utf-8'), { name: fileName });
    const sent = await channel.send({
      content: prefix || undefined,
      files: [file],
    });
    results.push(sent);
    return results;
  }

  const chunks = splitLongText(normalized, DISCORD_MAX_MESSAGE_LENGTH);

  for (let i = 0; i < chunks.length; i += 1) {
    const content = i === 0 && prefix ? `${prefix}\n${chunks[i]}` : chunks[i];
    const sent = await channel.send({ content });
    results.push(sent);
  }

  return results;
}

async function postDraftReviewConfirmation({
  channel,
  roundNumber,
  draftMarkdown,
  reviewerVerdict,
  reviewerComment,
}) {
  const verdictLabel = reviewerVerdict === 'ok' ? 'OK' : 'NEEDS_REVISION';
  const summary = buildDraftSummary(draftMarkdown);

  const intro = [
    `📝 ドラフト確認（Round ${roundNumber}）`,
    `判定: ${verdictLabel}`,
    '',
    'ドラフト要約:',
    summary,
    '',
    '返信方法:',
    '- OK（この内容で確定）',
    '- 修正指示（修正したい内容を具体的に記載）',
  ].join('\n');

  await postLongText(channel, intro);

  if (reviewerComment && reviewerComment.trim()) {
    await postLongText(channel, reviewerComment, {
      prefix: '📝 レビューコメント',
    });
  }

  await postLongText(channel, draftMarkdown, {
    prefix: '📝 ドラフト全文（Markdown添付）',
    forceFile: true,
    fileName: `draft-round-${roundNumber}.md`,
  });
}

async function postQuestionForHuman({ channel, questionText, sourceRole, isFollowUp = false }) {
  const source = sourceRole === 'reviewer' ? 'レビュー役' : '要件定義役';
  const header = isFollowUp
    ? `❓ 質問（${source}）\n（内部協議でも解決しなかったため再度確認します）`
    : `❓ 質問（${source}）`;

  await postLongText(channel, questionText, { prefix: header });
}

async function postAiDiscussion({ channel, role, messageType, content }) {
  const label = roleToLabel(role);
  const typeLabel = messageType === 'internal_deliberation' ? '内部協議' : '通常';
  const prefix = `🗣️ ${label}（${typeLabel}）`;

  if (role === 'requirements_writer') {
    await postLongText(channel, content, {
      prefix,
      forceFile: true,
      fileName: `ai-${role}-${Date.now()}.md`,
    });
    return;
  }

  await postLongText(channel, content, { prefix });
}

async function postAmbiguousDraftReplyNotice(channel) {
  await postLongText(
    channel,
    '返信内容を判定できませんでした。\n「OK」または「修正指示（例: 3章に検索機能を追記してください）」のどちらかで返信してください。',
    { prefix: '📝 再確認' },
  );
}

async function postAmbiguousQuestionAnswerNotice(channel) {
  await postLongText(
    channel,
    '質問への回答として解釈できませんでした。もう少し具体的に回答してください。',
    { prefix: '❓ 再確認' },
  );
}

async function postAcknowledgedOk(channel) {
  await postLongText(
    channel,
    'OKを受け付けました。確定処理はM8で実装予定のため、現時点ではセッションをconfirmedとして終了します。',
    { prefix: '✅ 受付完了' },
  );
}

module.exports = {
  DISCORD_MAX_MESSAGE_LENGTH,
  splitLongText,
  buildDraftSummary,
  postLongText,
  postDraftReviewConfirmation,
  postQuestionForHuman,
  postAiDiscussion,
  postAmbiguousDraftReplyNotice,
  postAmbiguousQuestionAnswerNotice,
  postAcknowledgedOk,
};
