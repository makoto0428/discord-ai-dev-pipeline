# Discord AI Dev Pipeline

Discordへの投稿をきっかけに、複数のAI（Ollama上で動作するローカルLLM）が協調して、
**要件定義 → システム設計 → コード自動生成・実行** までを段階的に進めていく開発パイプライン。

各フェーズは独立したモジュールとして本リポジトリ内で管理し、Markdownファイルを介して疎結合に連携する。

---

## 現在の状況

| フェーズ | 内容 | ステータス |
|---|---|---|
| **Phase 1** | 要件定義自動生成Bot | 設計中（本READMEの主対象） |
| Phase 2 | システム設計自動生成（UI設計・DB設計・詳細設計） | 未着手 |
| Phase 3 | コード自動生成・実行システム | 未着手 |

現在実装を進めているのは **Phase 1: 要件定義自動生成Bot** です。以降の内容は主にPhase 1についての説明です。

---

## Phase 1: 要件定義自動生成Bot とは

Discordの特定チャンネルに「作りたいシステムのラフな要望」を投稿すると、
3つの役割を持つAIが裏側で議論しながら、実装に耐えうる本格的な要件定義書（Markdown）を作成するBotです。

### 登場するAIロール

| ロール | 役割 |
|---|---|
| 🧭 指示役AI | 人間の要望・回答を解釈し、要件定義役への指示を整理する進行役。AI⇔人間の翻訳役も兼ねる |
| ✍️ 要件定義役AI | 指示役からの指示をもとに要件定義書のドラフトを作成・更新する |
| 🔍 レビュー役AI | ドラフトをレビューし、不備・矛盾を指摘、OK/NG判定を行う |

3ロールはそれぞれ異なるOllamaモデルで動作します（`.env`で設定）。

### 全体フロー（概要）

```
人間: Discordの対象チャンネルにラフな要望を投稿
   ↓
指示役 → 要件定義役 → レビュー役 が裏側で議論（Discordには非表示。可視化モードON時は表示）
   ↓
議論の節目で、人間に確認（📝 OK / 修正指示）
   ↓
AIチーム内で解決できない疑問点があれば、その都度質問（❓）
   → 人間の回答後、同じ論点で再度疑問が出た場合はAI同士でまず内部協議 → それでも無理なら再質問
   ↓
レビューOK、または規定ラウンド数に到達したら要件定義を確定
   ↓
本格的なテンプレート形式のMarkdownファイルとしてローカル保存（✅完了報告）
```

詳細な仕様は [`docs/phase1-requirements-bot/`](./docs/phase1-requirements-bot/) 配下のドキュメントを参照してください。

- [要件定義書](./docs/phase1-requirements-bot/要件定義自動生成Bot_要件定義書.md)
- [詳細設計書](./docs/phase1-requirements-bot/要件定義自動生成Bot_詳細設計書.md)
- [AIロール プロンプト設計書](./docs/phase1-requirements-bot/要件定義自動生成Bot_プロンプト設計書.md)
- [実装タスクリスト](./docs/phase1-requirements-bot/要件定義自動生成Bot_実装タスクリスト.md)

---

## リポジトリ構成

```
project-root/
├── phase1-requirements-bot/   # Phase 1: 要件定義自動生成Bot（本体）
├── phase2-design-bot/         # Phase 2: システム設計自動生成（未着手）
├── phase3-codegen-system/     # Phase 3: コード自動生成・実行システム（未着手）
├── shared/                    # 全フェーズで使い回す共通コード（Ollamaクライアント、DB接続処理など）
├── docs/                      # 各フェーズの要件定義書・設計書
└── README.md                  # 本ファイル
```

各フェーズはPhase 1から順に開発し、動かしながら得た知見をもとに次フェーズを設計していく方針です。

---

## セットアップ（Phase 1）

### 必要なもの

- Node.js（discord.js等を使用）
- Discord Bot Token（[Discord Developer Portal](https://discord.com/developers/applications)で発行）
- Ollamaサーバー（Botサーバーとは別のGPUマシンでの稼働を想定）

### 手順

```bash
cd phase1-requirements-bot
npm install
cp .env.example .env
# .env を編集し、以下を設定
#   DISCORD_BOT_TOKEN
#   DISCORD_TARGET_CHANNEL_ID
#   DISCORD_ADMIN_USER_ID
#   OLLAMA_HOST（別GPUマシンのOllamaサーバーアドレス）
#   OLLAMA_MODEL_DIRECTOR / OLLAMA_MODEL_REQUIREMENTS / OLLAMA_MODEL_REVIEWER
npm start
```

主な環境変数の一覧は [要件定義書 6章](./docs/phase1/要件定義自動生成Bot_要件定義書.md#6-想定環境変数env例) を参照してください。

### 使い方

1. Discordの対象チャンネルに、作りたいシステムのラフな要望を投稿する
2. Botからの確認（📝 ドラフト確認 / ❓ 質問）にテキストで返信していく
3. 完成すると ✅ で完了報告があり、`phase1-requirements-bot/output/requirements/` にMarkdownファイルが生成される
4. 生成されたファイルは手動でGitにcommitする（Botは自動commitしない）

---

## 今後の展望

- **Phase 2**: Phase 1で生成された要件定義書をインプットに、UI設計・DB設計・詳細設計を自動生成する仕組みを構築（Phase 1と同様の3AI協調構成を踏襲予定）
- **Phase 3**: Phase 2の設計書をインプットに、Dockerサンドボックス環境上でAIがコードを生成・実行する仕組みを構築

いずれも本リポジトリ内の対応フォルダで、Phase 1の運用実績を踏まえてから詳細要件を定義していきます。

---

## ライセンス

（未定）
