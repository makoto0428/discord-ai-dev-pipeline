/**
 * scripts/checkOllama.js
 * M4向けのOllama接続確認スクリプト。
 * 3つのロール設定モデルに対して短いプロンプトを投げ、応答取得を確認する。
 *
 * 実行: npm run check-ollama
 */

require('dotenv').config();

const { chatWithRole, getModelNameByRole } = require('../../shared/ollama/ollamaClient');

const ROLE_TEST_CASES = [
  { role: 'director', prompt: '要件定義プロジェクトの開始時に確認すべき要点を1つだけ答えてください。' },
  { role: 'requirements_writer', prompt: '要件定義書の機能要件を簡潔に1行で説明してください。' },
  { role: 'reviewer', prompt: 'レビュー時に最初に見る観点を1つだけ答えてください。' },
];

function preview(text, maxLen = 120) {
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

async function main() {
  console.log('M4: Ollama接続確認を開始します。\n');

  for (const testCase of ROLE_TEST_CASES) {
    const modelName = getModelNameByRole(testCase.role);
    console.log(`- role=${testCase.role}, model=${modelName}`);

    const response = await chatWithRole({
      role: testCase.role,
      userPrompt: testCase.prompt,
    });

    console.log(`  response: ${preview(response.content)}\n`);
  }

  console.log('✅ 3ロールすべてで応答を確認できました。');
}

main().catch((error) => {
  console.error('❌ Ollama接続確認に失敗しました。');
  console.error(error?.message || error);
  process.exit(1);
});