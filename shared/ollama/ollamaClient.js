const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_HOST = 'http://localhost:11434';

const ROLE_MODEL_ENV_KEYS = {
  director: 'MODEL_DIRECTOR',
  requirementsWriter: 'MODEL_REQUIREMENTS_WRITER',
  requirements_writer: 'MODEL_REQUIREMENTS_WRITER',
  reviewer: 'MODEL_REVIEWER',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOllamaConfig(env = process.env) {
  const timeoutMs = Number.parseInt(env.OLLAMA_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10);
  const retryCount = Number.parseInt(env.OLLAMA_RETRY_COUNT || `${DEFAULT_RETRY_COUNT}`, 10);

  return {
    host: env.OLLAMA_HOST || DEFAULT_HOST,
    timeoutMs: Number.isNaN(timeoutMs) ? DEFAULT_TIMEOUT_MS : timeoutMs,
    retryCount: Number.isNaN(retryCount) ? DEFAULT_RETRY_COUNT : retryCount,
  };
}

function getModelNameByRole(role, env = process.env) {
  const envKey = ROLE_MODEL_ENV_KEYS[role];

  if (!envKey) {
    throw new Error(`未対応のロールです: ${role}`);
  }

  const modelName = env[envKey];
  if (!modelName) {
    throw new Error(`環境変数 ${envKey} が設定されていません。`);
  }

  return modelName;
}

function extractContentFromResponse(data) {
  // /api/chat 応答
  if (typeof data?.message?.content === 'string') {
    return data.message.content.trim();
  }

  // /api/generate 応答（将来切り替え時の互換）
  if (typeof data?.response === 'string') {
    return data.response.trim();
  }

  return '';
}

function isConnectionError(error) {
  if (error?.name === 'AbortError') {
    return true;
  }

  return error?.cause?.code === 'ECONNREFUSED' || error?.cause?.code === 'ENOTFOUND';
}

async function requestOllamaChat({
  host,
  body,
  timeoutMs,
}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${host}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function chatWithRole({
  role,
  systemPrompt,
  userPrompt,
  messages,
  model,
  stream = false,
  logger = console,
}) {
  const { host, timeoutMs, retryCount } = getOllamaConfig();
  const modelName = model || getModelNameByRole(role);

  const requestBody = {
    model: modelName,
    messages: messages || [
      { role: 'system', content: systemPrompt || '' },
      { role: 'user', content: userPrompt || '' },
    ],
    stream,
  };

  let invalidResponseRetried = false;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const data = await requestOllamaChat({
        host,
        body: requestBody,
        timeoutMs,
      });

      const content = extractContentFromResponse(data);
      if (!content) {
        if (!invalidResponseRetried) {
          invalidResponseRetried = true;
          logger.warn?.('Ollamaのレスポンスが空/不正だったため再試行します', {
            role,
            modelName,
          });
          continue;
        }

        throw new Error('Ollamaのレスポンス本文を抽出できませんでした。');
      }

      return {
        role,
        modelName,
        content,
        raw: data,
      };
    } catch (error) {
      const shouldRetry = isConnectionError(error) && attempt < retryCount;

      if (shouldRetry) {
        logger.warn?.('Ollama接続に失敗したためリトライします', {
          role,
          modelName,
          attempt: attempt + 1,
          retryCount,
          error: error.message,
        });
        await sleep(500 * (attempt + 1));
        continue;
      }

      if (isConnectionError(error)) {
        throw new Error(`Ollamaサーバーに接続できません: ${error.message}`);
      }

      throw error;
    }
  }

  throw new Error('Ollama呼び出しに失敗しました。');
}

module.exports = {
  chatWithRole,
  getModelNameByRole,
  getOllamaConfig,
};