// 画面の骨組みだけをキャッシュする。APIはネットワーク直（オフラインではPDFを開けない）
// lib の self は Window 型なので、Service Worker 側のスコープに読み替える
// import/export を書くと ESM 扱いになり classic SW として登録できない（出力は sw.js 1本きり）
const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = "pdf-live-viewer-v1";
const ASSETS = [
    "/",
    "/index.html",
    "/style.css",
    "/app.js",
    "/manage.js",
    "/view.js",
    "/viewer.js",
    "/sketch.js",
    "/sketch-model.js",
    "/ui.js",
    "/export.js",
    "/manifest.webmanifest",
    "/icon.svg",
    "/icon-192.png",
    "/icon-512.png",
];

sw.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then((cache) => cache.addAll(ASSETS))
            .then(() => sw.skipWaiting()),
    );
});

sw.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((k) => k !== CACHE)
                        .map((k) => caches.delete(k)),
                ),
            )
            .then(() => sw.clients.claim()),
    );
});

// ネットワーク優先。落ちたときだけキャッシュ（配信物を更新しても古いJSが残らない）
sw.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (
        event.request.method !== "GET" ||
        url.origin !== location.origin ||
        url.pathname.startsWith("/api/")
    )
        return;
    event.respondWith(
        fetch(event.request)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    void caches
                        .open(CACHE)
                        .then((cache) => cache.put(event.request, copy));
                }
                return res;
            })
            .catch(
                async () =>
                    // キャッシュにも "/" にも無ければ通信エラー応答（undefined は respondWith に渡せない）
                    (await caches.match(event.request)) ??
                    (await caches.match("/")) ??
                    Response.error(),
            ),
    );
});
