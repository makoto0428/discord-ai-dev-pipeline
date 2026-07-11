# 要件定義自動生成Bot 詳細設計書

作成日: 2026-07-10
バージョン: v0.1（初版）
対応する要件定義書: 要件定義自動生成Bot_要件定義書.md

---

## 1. モジュール／フォルダ構成

本Botは、将来のフェーズ2（システム設計自動生成）・フェーズ3（コード自動生成・実行）を見据え、
単一リポジトリ内でフェーズごとにフォルダを分けるモノレポ構成とする。

```
project-root/
├── phase1-requirements-bot/       # 本Bot（要件定義自動生成Bot）
│   ├── src/
│   │   ├── index.js                 # エントリーポイント（Bot起動）
│   │   ├── discord/
│   │   │   ├── client.js             # Discordクライアント初期化・ログイン
│   │   │   ├── eventHandlers.js      # messageCreate等のイベント処理
│   │   │   └── messageBuilder.js     # Discordへの投稿メッセージ整形
│   │   ├── orchestrator/
│   │   │   ├── sessionManager.js     # セッション状態の生成・更新・終了判定
│   │   │   ├── roundRunner.js        # 指示役→要件定義役→レビュー役の1ラウンド実行
│   │   │   └── roles/
│   │   │       ├── director.js       # 指示役ロジック
│   │   │       ├── requirementsWriter.js # 要件定義役ロジック
│   │   │       └── reviewer.js       # レビュー役ロジック（OK/NG判定含む）
│   │   ├── db/
│   │   │   ├── schema.sql            # テーブル定義（phase1固有のテーブル: sessions/messages/drafts）
│   │   │   └── db.js                 # SQLite接続・CRUD関数（shared/db/baseDb.jsの接続処理を利用）
│   │   └── output/
│   │       └── markdownExporter.js   # 確定した要件定義書のMarkdown生成
│   ├── prompts/
│   │   ├── director.md
│   │   ├── requirementsWriter.md
│   │   └── reviewer.md
│   ├── output/
│   │   └── requirements/             # 生成物の保存先（.gitignore対象）
│   ├── .env.example
│   ├── package.json
│   └── README.md
│
├── phase2-design-bot/              # 将来: システム設計自動生成（未着手、フォルダのみ確保）
│
├── phase3-codegen-system/          # 将来: コード自動生成・実行システム（未着手、フォルダのみ確保）
│
├── shared/                         # フェーズ間で使い回す共通コード（phase1の時点から直接利用する）
│   ├── ollama/
│   │   └── ollamaClient.js           # Ollama API共通クライアント（役割・モデル名を引数で受け取る汎用実装）
│   └── db/
│       └── baseDb.js                 # SQLite接続の共通処理（接続オープン・マイグレーション実行等）
│
├── docs/                           # 各フェーズの要件定義書・設計書をまとめて管理
│   ├── phase1/
│   │   ├── 要件定義自動生成Bot_要件定義書.md
│   │   ├── 要件定義自動生成Bot_詳細設計書.md
│   │   ├── 要件定義自動生成Bot_プロンプト設計書.md
│   │   └── 要件定義自動生成Bot_実装タスクリスト.md
│   ├── phase2/                       # 未着手
│   └── phase3/                       # 未着手
│
└── README.md                       # リポジトリ全体の概要
```

補足:
- `shared/`配下は、phase1の実装時点から直接利用する（暫定配置は行わない）。Ollama呼び出し・DB接続共通処理は最初から`shared/`に実装し、`phase1-requirements-bot`側からimportして使う。
- phase1固有のロジック（3AIオーケストレーション、セッション/メッセージ/ドラフトのCRUD、要件定義書テンプレート生成等）は`phase1-requirements-bot/`側に置く。
- `phase2-design-bot/`・`phase3-codegen-system/`は、それぞれのフェーズの要件定義が固まってから中身を実装する（フォルダ自体は先に確保しておく）。

---

## 2. DBスキーマ（SQLite）

### 2.1 sessions テーブル
セッション（1回の要件定義対話）の状態を管理する。

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_channel_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
    -- 'in_progress' | 'confirmed' | 'cancelled' | 'error'
  round_count INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,  -- 質問対応の回数（MAX_ROUNDSにはカウントしない）
  deliberation_count INTEGER NOT NULL DEFAULT 0,  -- 現在の質問チェーンにおける内部協議の試行回数（解決 or 人間へ再質問した時点で0にリセット）
  initial_request TEXT NOT NULL,   -- 最初にユーザーが投稿したラフな要望
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.2 messages テーブル
3AI間および人間とのやりとりの生ログ。

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
    -- 'human' | 'director' | 'requirements_writer' | 'reviewer'
  message_type TEXT NOT NULL DEFAULT 'normal',
    -- 'normal'（通常のラウンド内発言） | 'question'（要件定義役 or レビュー役からの質問）
    -- | 'question_answer'（質問への人間の回答） | 'internal_deliberation'（AI同士の内部協議中の発言）
  content TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.3 drafts テーブル
各ラウンド時点での要件定義ドラフトとレビュー結果。

```sql
CREATE TABLE drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  round_number INTEGER NOT NULL,
  content_markdown TEXT NOT NULL,
  writer_question TEXT,   -- 要件定義役が質問を出した場合の質問文（なければNULL）
  reviewer_verdict TEXT,   -- 'ok' | 'needs_revision' | 'question' | NULL(未レビュー・質問によりスキップ)
  reviewer_comment TEXT,   -- reviewer_verdict='question'の場合はここに質問文を格納
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. 全体シーケンス（技術的な処理フロー）

1. **セッション開始**
   - `messageCreate`イベント発火 → 対象チャンネル・管理者チェック → 進行中セッションの有無を確認
   - 進行中セッションがなければ `sessionManager.createSession()` を呼び出し、`sessions`テーブルに新規行を作成（`round_count = 0`, `status = 'in_progress'`）
   - 初回メッセージを `messages` テーブルに `role: 'human'` として保存

2. **ラウンド実行（`roundRunner.runRound()`）**
   - 指示役AI呼び出し: これまでの会話履歴＋最新の人間の入力を渡し、要件定義役への指示文を生成
   - 要件定義役AI呼び出し: 指示役からの指示＋現在のドラフト（あれば）を渡し、更新版ドラフト（Markdown）を生成
     - **出力に「## 要確認事項」が空でない場合 → `writer_question`に保存し、質問分岐（手順3.5 or 3.6）へ**
   - レビュー役AI呼び出し（要件定義役に質問がなかった場合のみ実行）: 更新版ドラフトを渡し、`VERDICT: OK` / `VERDICT: NEEDS_REVISION` / `VERDICT: QUESTION` ＋コメントを生成
     - **`VERDICT: QUESTION`の場合 → コメント欄の質問文を`reviewer_comment`に保存し、質問分岐（手順3.5 or 3.6）へ**
   - 各AIの発言を `messages` テーブルに記録（`message_type: 'normal'`）、ドラフトを `drafts` テーブルに記録
   - `sessions.round_count` をインクリメント（質問分岐した場合はインクリメントしない。手順3.5/3.6参照）

3. **終了判定（`sessionManager.checkCompletion()`）**
   - `reviewer_verdict === 'ok'` → 確定処理へ
   - `round_count >= max_rounds` → 確定処理へ（強制終了）
   - どちらでもなければ → 人間への確認ステップ（手順4）へ

3.5. **質問対応フロー（新規の論点について質問が出た場合）**
   - 「新規の論点」の判定: このセッションで直前に発生した質問関連イベントが`question_answer`（＝直前ラウンドが質問への回答を受けた直後）でない場合、新規の質問として扱う
   - 質問元（要件定義役／レビュー役）の質問文を、指示役AIに渡して人間向けに読みやすい形へ整形させる
   - Botが `❓ 質問` 形式でDiscordに投稿する（通常のドラフト確認`📝`とは絵文字で区別する。詳細は4章のメッセージフォーマットを参照）
   - `sessions.question_count` をインクリメント（`round_count`はインクリメントしない＝MAX_ROUNDSにはカウントしない）
   - `sessions.deliberation_count` を0にリセット
   - 質問を`messages`テーブルに `message_type: 'question'` として記録
   - 人間の回答を受信 → `messages`テーブルに `message_type: 'question_answer'` として記録
   - 回答内容を次のラウンドの指示役AIへの入力に追加し、手順2（ラウンド実行）に戻る（このやり直しラウンドは通常のラウンドとしてカウントする）

3.6. **内部協議フロー（人間の回答直後に、同じ論点で再度質問が出た場合）**
   - 「同じ論点の再質問」の判定: 直前の`messages`が`question_answer`であり、かつその直後のラウンド（手順2）で再び要件定義役 or レビュー役から質問が出た場合、この分岐に入る
   - `sessions.deliberation_count` をインクリメント
   - **`deliberation_count <= MAX_INTERNAL_DELIBERATION` の場合**:
     - 指示役AIが「人間の直前の回答」と「新たに生じた疑問点」を要件定義役（必要であればレビュー役も）に渡し、
       「人間には戻さず、妥当な仮定を置くか、両者で議論して解決を試みてほしい」という指示のもと再実行させる
     - このやりとりは`messages`テーブルに `message_type: 'internal_deliberation'` として記録する（`round_count`・`question_count`ともにインクリメントしない）
     - 質問が解消された（新たな「## 要確認事項」やVERDICT: QUESTIONが出ない）→ `deliberation_count`を0にリセットし、通常のラウンド結果として手順3（終了判定）へ進む
     - 質問が解消されない → 再度手順3.6を実行（`deliberation_count`をインクリメントして再試行）
   - **`deliberation_count > MAX_INTERNAL_DELIBERATION` の場合**:
     - それ以上の内部協議は打ち切り、`deliberation_count`を0にリセットした上で、手順3.5（質問対応フロー）に進み、改めて人間に❓質問する
     - この際、Discord投稿には「（内部協議でも解決しなかったため再度確認します）」等、フォローアップであることが分かる一言を添える

4. **人間への確認（通常のドラフト確認）**
   - Botが現在のドラフト要約＋レビュー役のコメントを `📝 ドラフト確認` 形式でDiscordに投稿し、「OKか修正指示か」を尋ねる
   - 人間の返信を受信 → `messages` テーブルに `role: 'human'`, `message_type: 'normal'` として保存
   - 返信が「OK」であれば確定処理へ、修正指示であればその内容を次ラウンドの指示役への入力に追加して2に戻る

5. **確定処理**
   - `sessionManager.finalizeSession()` を呼び出し、`sessions.status = 'confirmed'` に更新
   - `markdownExporter.export()` で最終ドラフトを本フォーマット（要件定義書テンプレート）に整形し、`output/requirements/` 配下にファイル保存
   - Discordに完了報告＋保存先パスを投稿

---

## 4. Discordイベント対応表

| イベント | 条件 | 処理 |
|---|---|---|
| `messageCreate` | 対象チャンネル＋管理者＋進行中セッションなし | 新規セッション開始（手順1〜2） |
| `messageCreate` | 対象チャンネル＋管理者＋進行中セッションあり | 人間からの返信として処理（手順4） |
| `messageCreate` | 対象チャンネル以外、または非管理者 | 無視 |

### 4.1 Bot投稿メッセージのフォーマット区別

`messageBuilder.js`にて、投稿する内容の種類に応じて先頭に絵文字を付与し、人間が見た目で区別できるようにする。

| 種類 | 絵文字 | 発生元 |
|---|---|---|
| 質問（要確認事項） | ❓ | 要件定義役 または レビュー役（`VERDICT: QUESTION`） |
| 通常のドラフト確認（OK/修正指示） | 📝 | レビュー役の通常判定後（`VERDICT: OK` / `NEEDS_REVISION`） |
| 完了報告 | ✅ | 確定処理完了時 |
| エラー通知 | ⚠️ | Ollama接続エラー等 |
| AI発言（可視化モード時のみ） | 🗣️ | 指示役／要件定義役／レビュー役の発言（内部協議中の発言も含む） |

補足: `SHOW_AI_DISCUSSION=false`（デフォルト）の場合、内部協議（`message_type: 'internal_deliberation'`）を含む3AI間の発言はDB上には記録するがDiscordには投稿しない（F-03）。`SHOW_AI_DISCUSSION=true`の場合は、各AI呼び出しの都度、発言内容を🗣️付きでリアルタイムに投稿する（4.2節の長文対応ルールに従う）。

### 4.2 長文投稿への対応（Discord 2000文字制限）

| 対象 | 想定される長さ | 対応方法 |
|---|---|---|
| 指示役の指示文、レビュー役のコメント・質問 | 比較的短い（数百文字程度を想定） | 2000文字を超える場合のみ、複数メッセージに自動分割して連続投稿する |
| 要件定義役のドラフト全文 | 長くなりやすい（数千文字になり得る） | 常にMarkdownファイル（`.md`）として添付投稿する（本文には概要のみ添える） |

- 分割送信・添付判定はいずれも`messageBuilder.js`内の共通関数（例: `postLongText()`）で行い、各呼び出し元（通常確認・質問・可視化モードでのAI発言投稿）から共通利用する。
- 可視化モードで要件定義役の発言を投稿する際も、この4.2節のルールに従い、常にファイル添付とする（本文が長いため分割よりも添付の方が読みやすいため）。

---

## 5. Ollama呼び出し仕様

- エンドポイント: `POST ${OLLAMA_HOST}/api/generate`（または`/api/chat`。ロールごとに会話文脈を保持する場合は`/api/chat`を推奨）
- リクエストボディ例:
```json
{
  "model": "<役割ごとのモデル名>",
  "messages": [
    { "role": "system", "content": "<prompts/*.md の内容>" },
    { "role": "user", "content": "<直前までの文脈＋今回の入力>" }
  ],
  "stream": false
}
```
- レスポンスから本文テキストを抽出し、呼び出し元（`roundRunner`）に返す
- タイムアウトは`.env`の`OLLAMA_TIMEOUT_MS`で設定可能とする（デフォルト値を仮に30000msとする）

---

## 6. エラーハンドリング仕様

| ケース | 挙動 |
|---|---|
| Ollama接続失敗（タイムアウト・接続拒否） | 指定回数（例: 2回）まで自動リトライ → 失敗が続く場合はDiscordに「Ollamaサーバーに接続できません」と通知し、セッションを`status: 'error'`として一時停止 |
| Ollamaのレスポンスが空/不正 | ログに記録し、1回だけ再試行 → 再度失敗した場合はエラー通知 |
| レビュー役の判定フォーマットが不正（VERDICTが`OK`/`NEEDS_REVISION`/`QUESTION`のいずれとも一致しない） | `needs_revision`扱いとして安全側に倒し、次ラウンドへ回す |
| 人間の返信が「OK」でも「修正指示」でもない曖昧な内容（通常のドラフト確認時） | 「OKか修正指示か分かりませんでした。もう一度お願いします」と再確認を促す |
| 質問（❓）への人間の返信が質問の答えとして解釈できない曖昧な内容 | 「もう少し具体的に教えていただけますか」と同じ質問文脈のまま再確認を促す（`question_count`は再カウントしない） |

---

## 7. 状態遷移（sessions.status）

```
in_progress ──(レビューOK or 最大ラウンド到達)──> confirmed
in_progress ──(Ollama接続エラー継続)──> error
in_progress ──(人間がキャンセル指示 ※将来拡張)──> cancelled
```

---

## 8. 未確定事項（詳細設計レベル）

- リトライ回数・待機時間の具体的な値
- 「議論の節目」の粒度（1ラウンド＝1回の3AIやりとりで毎回人間に聞くのか、複数ラウンドまとめてから聞くのか）→ 実装前に確定推奨
- ~~ドラフト要約をDiscordに投稿する際の文字数制限対応~~ → 4.2節で解決済み（短文は分割送信、ドラフト全文は添付ファイル）
