# 要件定義自動生成Bot 実装タスクリスト

作成日: 2026-07-10
バージョン: v0.1（初版）

GitHub Copilot等に1タスクずつ渡していくことを想定したマイルストーン分割。
各マイルストーンは、前のマイルストーンが完了してから着手する想定（依存関係あり）。

---

## M1. プロジェクト基盤構築
- [x] `package.json` 初期化、必要パッケージ導入（discord.js, sqlite3 or better-sqlite3, dotenv 等）
- [x] `.env.example` 作成（詳細設計書 6章の環境変数一覧を反映）
- [x] 基本的なロギング機構の用意（console出力で可、後で拡張しやすい形に）
- [x] `README.md` にセットアップ手順を記載

**完了条件**: `npm install` → `.env` 設定 → 空のBotがDiscordにログインできる状態

---

## M2. DB層実装
- [x] `phase1-requirements-bot/src/db/schema.sql` を詳細設計書のスキーマ通りに作成
- [x] `phase1-requirements-bot/src/db/db.js` でSQLite接続・マイグレーション実行処理を実装
- [x] `sessions` / `messages` / `drafts` それぞれのCRUD関数を実装
- [x] 簡易な動作確認スクリプト（セッション作成→メッセージ追加→取得、が一通り動くこと）

**完了条件**: DBファイルが生成され、CRUD操作がテストコードまたは簡易スクリプトで確認できる

---

## M3. Discord Bot雛形
- [x] `phase1-requirements-bot/src/discord/client.js` でBotログイン処理を実装
- [x] `messageCreate` イベントで「対象チャンネルか」「管理者か」を判定するガード処理を実装
- [x] 進行中セッションの有無をDBから確認する処理を実装（M2に依存）
- [x] 上記条件を満たした投稿を受け取り、コンソールにログ出力するだけの状態を作る（AI呼び出しはまだ行わない）

**完了条件**: 対象チャンネルに管理者が投稿すると「新規セッション」or「継続セッション」の判定ログが出る

---

## M4. Ollama連携
- [x] `shared/ollama/ollamaClient.js` を実装（詳細設計書5章のリクエスト仕様に準拠）
- [x] 役割ごとに異なるモデル名を`.env`から読み込めるようにする
- [x] タイムアウト・リトライ処理を実装（詳細設計書6章のエラーハンドリング仕様に準拠）
- [x] 単体で「プロンプトを投げて応答が返る」ことを確認するテストスクリプトを用意

**完了条件**: 3つのモデル名それぞれに対して、簡単なプロンプトを投げて応答が返ることを確認できる

---

## M5. AIロールの実装
- [x] `phase1-requirements-bot/prompts/director.md`, `phase1-requirements-bot/prompts/requirementsWriter.md`, `phase1-requirements-bot/prompts/reviewer.md` を配置（プロンプト設計書の内容）
- [x] `phase1-requirements-bot/src/orchestrator/roles/director.js` 実装（プロンプト読み込み＋Ollama呼び出し＋出力整形）
- [x] `phase1-requirements-bot/src/orchestrator/roles/requirementsWriter.js` 実装
- [x] `phase1-requirements-bot/src/orchestrator/roles/reviewer.js` 実装（VERDICTのパース処理を含む）

**完了条件**: 3つのロールそれぞれを個別に呼び出し、想定通りのフォーマットで応答が返ることを確認できる

---

## M6. 3AIオーケストレーションロジック
- [x] `phase1-requirements-bot/src/orchestrator/roundRunner.js` 実装（指示役→要件定義役→レビュー役を1ラウンドとして実行）
- [x] 要件定義役の出力から「## 要確認事項」を検出し、内容があればレビュー役呼び出しをスキップする分岐を実装
- [x] レビュー役の`VERDICT: QUESTION`を検出する分岐を実装
- [x] 「直前が`question_answer`かどうか」を判定し、新規質問／同一論点の再質問を区別するロジックを実装
- [x] 同一論点の再質問時に内部協議モード（`prompts`の追加指示付き）で発端ロールを再実行する処理を実装
- [x] `sessions.deliberation_count`のインクリメント・リセット処理を実装（`MAX_INTERNAL_DELIBERATION`超過で人間へエスカレーション）
- [x] 各ラウンドの発言・ドラフトをDBに保存する処理を実装（M2連携、`message_type`の出し分けを含む）
- [x] `sessions.round_count` のインクリメント処理を実装（質問分岐時はインクリメントしない）
- [x] `sessions.question_count` のインクリメント処理を実装（質問分岐時のみ）

**完了条件**: 人間の初回入力から1ラウンド分の3AI応答が生成され、DBに記録される。要件定義役・レビュー役どちらから質問が出ても正しく質問分岐に入ることを確認できる

---

## M7. 人間確認フロー
- [x] ドラフト要約＋レビューコメントを`📝`付きでDiscordに投稿する処理を実装（`phase1-requirements-bot/src/discord/messageBuilder.js`）
- [x] 質問（要件定義役／レビュー役由来）を指示役AIで整形し、`❓`付きでDiscordに投稿する処理を実装
- [x] `postLongText()`等の共通関数を実装し、2000文字超の短文発言は自動分割送信、ドラフト全文は常にMarkdownファイル添付とする処理を実装
- [x] `SHOW_AI_DISCUSSION=true`時に、指示役／要件定義役／レビュー役の発言（内部協議中含む）を`🗣️`付きでリアルタイム投稿する処理を実装
- [x] Discordメッセージの2000文字制限に対応した分割投稿処理を実装
- [x] 人間の返信を「OK」「修正指示」のどちらかに解釈する処理を実装（通常確認時）
- [x] 人間の返信を質問への回答として次ラウンドの指示役入力に渡す処理を実装（質問対応時）
- [x] 曖昧な返信の場合に再確認を促す処理を実装（両ケースとも）
- [x] 内部協議を経て再度エスカレーションされた質問には、フォローアップである旨の一言を添える処理を実装

**完了条件**: 「通常のドラフト確認」「質問への確認」「内部協議を経た再質問」のすべてについて、想定通りの分岐・投稿・引き継ぎが動作する

---

## M8. 終了条件・確定処理
- [x] `sessionManager.checkCompletion()` 実装（レビューOK判定／最大ラウンド到達の判定）
- [x] `sessionManager.finalizeSession()` 実装（`sessions.status`更新）
- [x] `phase1-requirements-bot/src/output/markdownExporter.js` 実装（最終ドラフトをテンプレート形式で整形し保存）
- [x] 確定時にDiscordへ完了報告＋保存パスを投稿する処理を実装

**完了条件**: レビューOK、または最大ラウンド到達のいずれかで、`output/requirements/`配下にMarkdownファイルが生成される

---

## M9. エンドツーエンド動作確認
- [ ] 実際にラフな要望を投げて、セッション開始〜確定までの一連の流れを通しで確認
- [ ] Ollama接続エラーを意図的に発生させ、エラーハンドリングが想定通り動くか確認
- [ ] Bot再起動後にセッションが継続できるか確認（DB永続化の確認）

**完了条件**: 想定シナリオ（正常系・エラー系・再起動系）がすべて期待通りに動作する

---

## M10.（任意）仕上げ
- [ ] ログの見直し・整理
- [ ] `.env`未設定時のエラーメッセージ改善
- [ ] READMEに運用手順（Botの起動方法、トラブルシューティング）を追記

---

## 補足
- M1〜M4はある程度並行して着手可能（DB層とOllama連携は独立性が高い）。ただしM5以降は前段のマイルストーンに依存するため、順番通りの実装を推奨。
- 各タスクをCopilotに渡す際は、対応する詳細設計書・プロンプト設計書の該当セクションを一緒に共有すると精度が上がる。
