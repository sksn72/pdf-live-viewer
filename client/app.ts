import { createManage } from "./manage.js";
import type { SseMessage } from "./view.js";
import { createView } from "./view.js";

const manageEl = document.getElementById("manage") as HTMLElement;
const viewEl = document.getElementById("view") as HTMLElement;

const manage = createManage({ root: manageEl });
const view = createView({ root: viewEl });

// #/f/<folderId> = PDF管理ページ、#/p/<pdfId> = PDFビューページ
async function route() {
    const pdfId = location.hash.match(/^#\/p\/([\w-]+)/)?.[1] ?? null;
    const folderId = location.hash.match(/^#\/f\/([\w-]+)/)?.[1] ?? null;
    if (pdfId) {
        manageEl.hidden = true;
        viewEl.hidden = false;
        await view.open(pdfId);
    } else {
        view.close();
        viewEl.hidden = true;
        manageEl.hidden = false;
        await manage.show(folderId);
    }
}

const es = new EventSource("/api/events");
es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as SseMessage;
    manage.onRemoteChange();
    view.onEvent(msg);
};

if ("serviceWorker" in navigator)
    void navigator.serviceWorker.register("/sw.js");

addEventListener("hashchange", () => void route());
void route();
