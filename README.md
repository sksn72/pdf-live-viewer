# PDF Live Viewer

社内LAN向けのPDF管理ビューア。認証なし。フォルダ階層でPDFを整理し、版を積み上げて管理する。
更新はSSEで表示中のブラウザへ自動反映される。表示中のPDFには版・ページ単位でスケッチを重ねられ、注釈付きPDFとして書き出せる。

## 画面

ハッシュルーティングで2ページに分かれる。

- `#/f/<folderId>` … PDF管理ページ。カレントフォルダ直下のフォルダとPDFだけを並べる（階層はパンくずで辿る）。
  フォルダ作成・改名・削除、PDFの追加・移動・削除、ゴミ箱。上部の検索欄でPDF名を全フォルダから検索できる。
- `#/p/<pdfId>` … PDFビューページ。表示・ズーム（25〜400%）・版切替・版の追加／削除・スケッチ・
  スケッチ付きPDF出力・ゴミ箱への移動。

表示はスマホ・タブレット幅（720px以下）でツールバーが横スクロールに変わり、PDFは幅に合わせて自動縮小される。
他の端末が版を追加・削除すると自動で反映され、最新版を表示中ならそのまま切り替わり、過去版を表示中ならバナーで知らせる。
PWA（manifest + Service Worker）に対応しているため、対応ブラウザではホーム画面に追加できる。

## 起動

Node.js 22.18 以降が必要。

```bash
npm install
npm start                    # クライアントをビルドして http://localhost:8080
PORT=9000 npm start          # ポート変更
DATA_DIR=/srv/pdf npm start  # データ置き場変更
```

サーバーは `0.0.0.0` で待ち受けるので、LAN内からは `http://<ホスト名またはIP>:8080` で開ける。
データは `data/`（`app.db` と `<uuid>/v<n>.pdf`）。`TRASH_DAYS`（既定7）、`MAX_UPLOAD_BYTES`（既定200MB）で調整可。

## 構成

```
src/server.ts   起動（PORT / DATA_DIR）
src/app.ts      HTTPルーティング、public配信、SSE、期限切れの完全削除
src/db.ts       node:sqlite のスキーマとクエリ
client/*.ts     ブラウザ側のソース（app=ルーティング、manage、view、viewer、sketch、export、sketch-model、sw=Service Worker）
public/         配信物。index.html・style.css・manifest.webmanifest・アイコン＋生成された *.js（sw.js を含む）
test/*.test.ts  node:test（API・DB・スケッチモデル）
```

`client/sketch-model.ts` はブラウザとサーバー（`validateStrokes`）の両方から import する。
ブラウザ側ソースは `client/` に置き、`public/` には手書きのファイルと生成物だけを置く（`public/*.js` は gitignore）。

## 開発

```bash
npm run dev        # ビルド + node --watch（サーバーとテストは .ts を直接実行）
npm test           # node --test --test-reporter=spec
npm run build      # client/*.ts → public/*.js（ブラウザ用。生成物は gitignore）
npm run typecheck  # tsc --noEmit
npm run format     # Biome
npm run lint       # Biome + tsc --noEmit
```

サーバーとテストは Node の型ストリップで `.ts` をそのまま実行する。ブラウザ側 `client/*.ts` だけ `tsc` で
`.js` を生成し、`npm start` / `npm run dev` が自動でビルドする。`index.html` の import map で
`pdfjs-dist` / `pdf-lib` を `/vendor/...` に解決している（実体は `node_modules` から配信）。

## 使い方

- 管理ページで「＋フォルダ」→ フォルダ名を入力。フォルダ行のクリックで中へ移動（パンくずで戻れる）。
- 「PDFを追加」またはドラッグ&ドロップで、開いているフォルダへ登録（登録時が第1版）。複数ファイルをまとめて選べる。
- PDF行の「移動」でフォルダを選んで移動、「削除」でゴミ箱へ（`TRASH_DAYS` 経過後に自動で完全削除）。
- PDF行をクリックするとビューページ。ツールバーの「版更新」でPDFを選ぶと次の版になる。
- 版の選択で過去版を表示。「この版を削除」で表示中の版を削除（最新版も可。残り1版のときは押せない）。
- 「スケッチ: オン」で描画。ペン／消しゴム（ボタンで切替）／色／太さ、筆圧対応（ペンのみ）、戻す／やり直し。
  ペン／消しゴム時はカーソルにブラシ径を表示する。
  確定したストロークは保存と同時に他の端末へ反映される（同じ版・同じページを見ている端末のみ。描画中のページは手元を優先）。
- キーボード: Ctrl/Cmd+Z で戻す、Ctrl/Cmd+Shift+Z または Ctrl+Y でやり直す。B/E でペン／消しゴム、+/- でズーム。Ctrl+ホイール上下でもズームできる。
- 「スケッチ表示: オン」でスケッチの重ね表示を切り替える。
- 「前の版から引き継ぐ」で前版のスケッチをページ単位でコピー（対象ページを選ぶ。ページサイズが違うと位置がずれる）。
- 「スケッチ付きPDF出力」で `<名前>-v<n>-annotated.pdf` をダウンロード。
- ビューページの「削除」でもゴミ箱へ移動。「← 管理」で元のフォルダへ戻る。
- 管理ページの「ゴミ箱」から復元／完全削除。
- 検索欄に入力すると、全フォルダのPDF名から部分一致で探せる。消すと元の一覧に戻る。

## API

| メソッド | パス                                      | 内容                                                                               |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| GET      | `/api/health`                             | `{ "ok": true }`                                                                   |
| GET      | `/api/events`                             | SSE。`{ type: "changed", id }` と `{ type: "sketch", id, version, page, strokes }` |
| GET      | `/api/tree`                               | フォルダ＋PDFの入れ子ツリー（削除済みPDFは含まない）                               |
| GET      | `/api/pdfs`                               | 有効なPDFの一覧                                                                    |
| POST     | `/api/pdfs?name=&folder=`                 | 本文はPDFバイト列。第1版として登録                                                 |
| GET      | `/api/pdfs/:id`                           | PDF1件＋版一覧                                                                     |
| PATCH    | `/api/pdfs/:id`                           | `{ "folderId": "<uuid>" \| null }` で移動                                          |
| DELETE   | `/api/pdfs/:id`                           | ゴミ箱へ（`TRASH_DAYS` 後に完全削除）                                              |
| POST     | `/api/pdfs/:id/restore`                   | ゴミ箱から復元                                                                     |
| DELETE   | `/api/pdfs/:id/purge`                     | 版・スケッチ・ファイルごと完全削除                                                 |
| GET      | `/api/trash`                              | ゴミ箱の一覧                                                                       |
| POST     | `/api/pdfs/:id/versions`                  | 本文はPDFバイト列。次の版を追加                                                    |
| GET      | `/api/pdfs/:id/versions/:n`               | 版のPDFバイト列（immutable キャッシュ）                                            |
| DELETE   | `/api/pdfs/:id/versions/:n`               | 版とスケッチを削除。残り1版なら 409、最新版を消すと `currentVersion` が下がる      |
| GET      | `/api/pdfs/:id/versions/:n/sketches`      | `{ "pages": { "<ページ番号>": strokes } }`                                         |
| PUT      | `/api/pdfs/:id/versions/:n/sketches/:p`   | `{ "strokes": [...] }` で上書き（204）                                             |
| POST     | `/api/pdfs/:id/versions/:n/sketches/copy` | `{ "from": <版>, "pages": [<ページ番号>] }` で前版からコピー                       |
| POST     | `/api/folders?name=&parent=`              | フォルダ作成（`parent` 省略でルート）                                              |
| PATCH    | `/api/folders/:id`                        | `{ "name": "..." }` で改名                                                         |
| DELETE   | `/api/folders/:id`                        | 空のときだけ削除。子フォルダか有効なPDFがあれば 409                                |

## 制限

- 認証なし。LAN内の誰でも削除・完全削除できる。
- フォルダ自体の移動（付け替え）は未実装。作成・改名・削除のみ。
- フォルダの削除は空のときだけ。ゴミ箱内のPDFだけが残っている場合はルート直下へ戻す。
- 版番号は詰めない（v2を消すと v1/v3 になる）。版ファイルは削除と同時に消える。
- ズームは 25〜400%。初期倍率は1ページ目の幅に合わせる。
- スケッチは版・ページ単位で保存し、版を削除するとその版のスケッチも消える。引き継ぎは直前の版からのみ。
- PDFは全ページ一括描画。数百ページ級では重くなる。
- 同一PDFへの同時アップロードは競合しうる（内部利用前提）。
- 同一ページのスケッチ同時編集は最後の保存が勝つ。
- `/Rotate` 付きページは注釈合成位置がずれる。
