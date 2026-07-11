# phase1-requirements-bot

Discord 上で AI 3役（指示役・要件定義役・レビュー役）が協議し、要件定義書を自動生成する Bot。

---

## 必要環境

| ソフトウェア | バージョン |
|---|---|
| Node.js | 18 以上（動作確認: v22） |
| npm | 9 以上 |
| Ollama | 最新安定版 |

---

## セットアップ手順

### 1. 依存パッケージのインストール

```bash
cd phase1-requirements-bot
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、各項目を埋めてください。

```bash
cp .env.example .env
```

| 変数名 | 説明 |
|---|---|
| `DISCORD_TOKEN` | Discord Developer Portal で取得した Bot トークン |
| `DISCORD_CHANNEL_ID` | Bot が対応するチャンネルの ID |
| `DISCORD_ADMIN_USER_ID` | Bot を操作できる管理者の Discord User ID |
| `OLLAMA_HOST` | Ollama サーバーの URL（デフォルト: `http://localhost:11434`） |
| `OLLAMA_TIMEOUT_MS` | Ollama API タイムアウト（ミリ秒、デフォルト: `30000`） |
| `OLLAMA_RETRY_COUNT` | 接続失敗時のリトライ回数（デフォルト: `2`） |
| `MODEL_DIRECTOR` | 指示役 AI に使用する Ollama モデル名 |
| `MODEL_REQUIREMENTS_WRITER` | 要件定義役 AI に使用する Ollama モデル名 |
| `MODEL_REVIEWER` | レビュー役 AI に使用する Ollama モデル名 |
| `MAX_ROUNDS` | 1 セッションの最大ラウンド数（デフォルト: `10`） |
| `MAX_INTERNAL_DELIBERATION` | 内部協議の最大試行回数（デフォルト: `2`） |
| `SHOW_AI_DISCUSSION` | AI 発言を Discord にリアルタイム投稿するか（`true`/`false`、デフォルト: `false`） |
| `DB_PATH` | SQLite DB ファイルのパス（デフォルト: `./data/bot.db`） |

### 3. Ollama のモデル準備

使用するモデルを Ollama でプルしてください。

```bash
ollama pull llama3
```

### 4. Bot の起動

```bash
npm start
```

起動に成功すると、コンソールに以下のようなログが出力されます。

```
[2026-07-11T00:00:00.000Z] [INFO] Bot が起動しました: YourBot#1234
```

### 5. 開発時（ファイル変更を自動検知して再起動）

```bash
npm run dev
```

---

## ディレクトリ構成

```
phase1-requirements-bot/
├── src/
│   ├── index.js                  # エントリーポイント
│   ├── utils/
│   │   └── logger.js             # ロガー
│   ├── discord/
│   │   ├── client.js             # Discord クライアント（M3 で実装）
│   │   ├── eventHandlers.js      # イベント処理（M3 で実装）
│   │   └── messageBuilder.js     # メッセージ整形（M7 で実装）
│   ├── orchestrator/
│   │   ├── sessionManager.js     # セッション管理（M6/M8 で実装）
│   │   ├── roundRunner.js        # ラウンド実行（M6 で実装）
│   │   └── roles/
│   │       ├── director.js       # 指示役（M5 で実装）
│   │       ├── requirementsWriter.js  # 要件定義役（M5 で実装）
│   │       └── reviewer.js       # レビュー役（M5 で実装）
│   ├── db/
│   │   ├── schema.sql            # テーブル定義（M2 で実装）
│   │   └── db.js                 # CRUD 関数（M2 で実装）
│   └── output/
│       └── markdownExporter.js   # Markdown 出力（M8 で実装）
├── prompts/
│   ├── director.md               # 指示役プロンプト（M5 で配置）
│   ├── requirementsWriter.md     # 要件定義役プロンプト（M5 で配置）
│   └── reviewer.md               # レビュー役プロンプト（M5 で配置）
├── output/
│   └── requirements/             # 生成された要件定義書の保存先
├── data/                         # SQLite DB ファイルの保存先（.gitignore 対象）
├── .env.example
├── package.json
└── README.md
```

---

## Discord Bot の権限設定

Discord Developer Portal で以下を有効化してください。

- **Bot Permissions**: `Send Messages`, `Read Message History`, `Attach Files`
- **Privileged Gateway Intents**: `Message Content Intent`
