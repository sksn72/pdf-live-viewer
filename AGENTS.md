# AGENTS.md

`README.md` の起動・構成・API・制限は前提。ここには実装時に踏みやすい点だけを書く。

## 検証

- CI はない。変更後は `npm run lint && npm test` をローカルで通す。
- 単体テストは `node --test --test-reporter=spec test/api.test.ts`。名前で絞るなら `--test-name-pattern` を足す。
- テストは一時 `DATA_DIR` と空きポートで自前のサーバーを起動する。外部サービスや事前データは不要。

## 実装時の注意

- `client/*.ts` を変更したら `npm run build`。`npm run dev` は起動時に一度ビルドするだけで、クライアントの変更を watch しない。
- import の拡張子を混ぜない。`src/` と `test/` は `.ts`（Node が型ストリップで直接実行）、`client/` 同士は `.js`（tsc が `public/*.js` に出力）。
- `client/sketch-model.ts` はサーバーの `validateStrokes` と共用。DOM 依存や副作用を持たせない。ストローク形式を変えるときは検証・描画・PDF 書き出しを同時に直す。
- `src/db.ts` は `CREATE TABLE IF NOT EXISTS` のみでは既存 DB に列が増えない。スキーマ変更時は `openDb` の `ALTER TABLE` 移行も追加する（`folder_id` が前例）。
- `src/app.ts` に API を足すときは `p.startsWith("/api/")` の 404 より前に置く。状態変更時は `broadcast({ type: "changed", id })` を忘れない（スケッチは `sketch` イベント）。
- `client/sw.ts` は classic Service Worker。`import`/`export` を書かない。`client/` にファイルを追加したら `ASSETS` も更新する。
