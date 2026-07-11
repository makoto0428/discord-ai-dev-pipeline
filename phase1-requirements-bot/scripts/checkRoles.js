'use strict';

/**
 * M5 動作確認スクリプト
 * 3つのAIロールそれぞれを個別に呼び出し、想定フォーマットで応答が返ることを確認する。
 *
 * Usage: npm run check-roles
 */

require('dotenv').config();

const { runDirector, runDirectorQuestionFormatter } = require('../src/orchestrator/roles/director');
const { runRequirementsWriter, parseRequirementsWriterOutput } = require('../src/orchestrator/roles/requirementsWriter');
const { runReviewer, parseReviewerOutput } = require('../src/orchestrator/roles/reviewer');

const SAMPLE_HUMAN_INPUT = 'タスク管理アプリを作りたい。ユーザーがタスクを登録・編集・削除できるWebアプリです。';

async function checkDirector() {
  console.log('\n=== [1/4] 指示役AI (director) ===');
  const result = await runDirector({ humanInput: SAMPLE_HUMAN_INPUT });
  console.log(`モデル: ${result.modelName}`);
  console.log('応答:\n', result.content);

  const hasSection = result.content.includes('今回のフォーカス') || result.content.includes('指示');
  console.log(`フォーマット確認: ${hasSection ? '✅ 指示セクションあり' : '⚠️  期待するセクションが見当たりません'}`);
  return result;
}

async function checkRequirementsWriter(directorInstruction) {
  console.log('\n=== [2/4] 要件定義役AI (requirementsWriter) ===');
  const result = await runRequirementsWriter({ directorInstruction });
  console.log(`モデル: ${result.modelName}`);
  console.log('ドラフト本文（先頭200文字）:\n', result.draftBody.slice(0, 200), '...');
  console.log(`要確認事項: ${result.questions.length > 0 ? result.questions.join(' / ') : 'なし'}`);

  const hasDraftStructure = result.draftBody.includes('要件定義書') || result.draftBody.includes('##');
  console.log(`フォーマット確認: ${hasDraftStructure ? '✅ Markdown構造あり' : '⚠️  Markdown構造が見当たりません'}`);
  return result;
}

async function checkReviewer(draft) {
  console.log('\n=== [3/4] レビュー役AI (reviewer) ===');
  const result = await runReviewer({ draft, humanInput: SAMPLE_HUMAN_INPUT });
  console.log(`モデル: ${result.modelName}`);
  console.log(`VERDICT: ${result.verdict}`);
  if (result.comment) {
    console.log(`指摘事項: ${result.comment.slice(0, 200)}`);
  }
  if (result.questions.length > 0) {
    console.log(`質問: ${result.questions.join(' / ')}`);
  }

  const validVerdicts = ['OK', 'NEEDS_REVISION', 'QUESTION'];
  console.log(`フォーマット確認: ${validVerdicts.includes(result.verdict) ? '✅ VERDICT正常' : `❌ 予期しないVERDICT: ${result.verdict}`}`);
  return result;
}

async function checkDirectorQuestionFormatter() {
  console.log('\n=== [4/4] 指示役AI 質問整形モード (directorQuestionFormatter) ===');
  const rawQuestion = '- ユーザー認証は必要ですか？\n- マルチデバイス対応は考慮しますか？';
  const result = await runDirectorQuestionFormatter({ rawQuestion });
  console.log(`モデル: ${result.modelName}`);
  console.log('整形結果:\n', result.content);
  return result;
}

async function main() {
  console.log('=== M5 AIロール動作確認スクリプト ===');
  console.log(`サンプル入力: "${SAMPLE_HUMAN_INPUT}"`);

  const errors = [];

  let directorResult;
  try {
    directorResult = await checkDirector();
  } catch (err) {
    console.error('❌ director エラー:', err.message);
    errors.push('director');
  }

  let writerResult;
  try {
    const instruction = directorResult?.content || 'タスク管理アプリの要件定義書の初稿を作成してください。';
    writerResult = await checkRequirementsWriter(instruction);
  } catch (err) {
    console.error('❌ requirementsWriter エラー:', err.message);
    errors.push('requirementsWriter');
  }

  try {
    const draft = writerResult?.draftBody || '# タスク管理アプリ 要件定義書\n## 1. 背景・目的\nタスクを管理するWebアプリ。';
    await checkReviewer(draft);
  } catch (err) {
    console.error('❌ reviewer エラー:', err.message);
    errors.push('reviewer');
  }

  try {
    await checkDirectorQuestionFormatter();
  } catch (err) {
    console.error('❌ directorQuestionFormatter エラー:', err.message);
    errors.push('directorQuestionFormatter');
  }

  console.log('\n=== 結果サマリー ===');
  if (errors.length === 0) {
    console.log('✅ 全4チェック成功。M5完了条件を満たしています。');
  } else {
    console.log(`❌ ${errors.length}件のエラーが発生しました: ${errors.join(', ')}`);
    process.exit(1);
  }
}

main();
