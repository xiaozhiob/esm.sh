/// <reference lib="dom" />
/// <reference lib="webworker" />

const VERSION = 135;

const tsx = featureDisabled("tsx");
const vue = featureDisabled("vue");

const doc = globalThis.document;
const enc = new TextEncoder();
const dec = new TextDecoder();
const { stringify, parse } = JSON;
const kJsxImportSource = "@jsxImportSource";
const kSkipWaiting = "SKIP_WAITING";
const kVfs = "vfs";

// open indexed database
let onOpen: () => void;
let onOpenError: (reason: DOMException | null) => void;
const openRequest = indexedDB.open("esm.sh/hot", VERSION);
const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  onOpen = () => resolve(openRequest.result);
  onOpenError = reject;
});
openRequest.onerror = function () {
  onOpenError(openRequest.error);
};
openRequest.onupgradeneeded = function () {
  const db = openRequest.result;
  if (!db.objectStoreNames.contains(kVfs)) {
    db.createObjectStore(kVfs, { keyPath: "id" });
  }
};
openRequest.onsuccess = function () {
  onOpen();
};

// virtual file system using indexed database
type VfsRecord = { id: string; hash: string; data: Uint8Array | string };
const getVfsStore = async (mode: IDBTransactionMode) => {
  const db = await dbPromise;
  return db.transaction(kVfs, mode).objectStore(kVfs);
};
const vfs = {
  async get(id: string) {
    const store = await getVfsStore("readonly");
    const req = store.get(id);
    return new Promise<VfsRecord | null>(
      (resolve, reject) => {
        req.onsuccess = () => resolve(req.result ? req.result : null);
        req.onerror = () => reject(req.error);
      },
    );
  },
  async put(id: string, hash: string, data: Uint8Array | string) {
    const store = await getVfsStore("readwrite");
    const req = store.put({ id, hash, data });
    return new Promise<void>((resolve, reject) => {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
};

class Hot {
  handlers: Record<string, () => Promise<VfsRecord>> = {};

  register<T extends string | Uint8Array>(
    name: string,
    fetcher: () =>
      | T
      | Response
      | Promise<T | Response>,
    handler: (input: T) =>
      | T
      | Response
      | Promise<T | Response>,
  ) {
    this.handlers[name] = async () => {
      let input = fetcher();
      if (input instanceof Promise) {
        input = await input;
      }
      if (input instanceof Response) {
        input = new Uint8Array(await input.arrayBuffer()) as T;
      }
      const hash = await computeHash(
        isString(input) ? enc.encode(input) : input,
      );
      const cached = await vfs.get(name);
      if (cached && cached.hash === hash) {
        return cached;
      }
      let data = input = handler(input);
      if (data instanceof Promise) {
        data = await data;
      }
      if (data instanceof Response) {
        data = new Uint8Array(await data.arrayBuffer()) as T;
      }
      if (cached && doc) {
        if (name.endsWith(".css")) {
          const url = `https://esm.sh/hot/${name}`;
          const el = doc.querySelector(`link[href="${url}"]`);
          if (el) {
            const copy = el.cloneNode(true) as HTMLLinkElement;
            copy.href = url + "?" + hash;
            el.replaceWith(copy);
          }
        }
        console.log(`[hot] ${name} updated`);
      }
      await vfs.put(name, hash, data);
      return { id: name, hash, data };
    };
    return this;
  }

  use(...milddlewares: ((hot: HotApp) => void)[]): this {
    milddlewares.forEach((mw) => mw(this));
    return this;
  }

  async run(swUrl = "/sw.js") {
    if (!doc) {
      throw new Error("HotApp.run() can't be called in Service Worker.");
    }

    const sw = navigator.serviceWorker;
    if (!sw) {
      throw new Error("Service Worker not supported.");
    }

    this.register(
      "importmap.json",
      () => {
        const im = doc.querySelector("head>script[type=importmap]");
        if (im) {
          const v = parse(im.innerHTML);
          const imports: Record<string, string> = {};
          const supported = HTMLScriptElement.supports?.("importmap");
          for (const k in v.imports) {
            if (!supported && k === kJsxImportSource) {
              imports[k] = v.imports[k];
            }
          }
          if (supported && "scopes" in v) {
            delete v.scopes;
          }
          return stringify({ ...v, imports });
        }
        return "{}";
      },
      (input) => input,
    );

    const updateVFS = Promise.all(
      Object.values(this.handlers).map((handler) => handler()),
    );

    const reg = await sw.register(swUrl, { type: "module" });

    // there's a waiting for reload
    reg.waiting?.postMessage({ type: kSkipWaiting });

    // detect Service Worker update available and wait for it to become installed
    reg.addEventListener("updatefound", () => {
      reg.installing?.addEventListener("statechange", () => {
        const { waiting } = reg;
        if (waiting) {
          // if there's an existing controller (previous Service Worker)
          if (sw.controller) {
            waiting.postMessage({ type: kSkipWaiting });
          } else {
            // otherwise it's the first install
            // invoke all handlers and store them to the database
            // then reload the page
            updateVFS.then(() => {
              reload();
            });
          }
        }
      });
    });

    // detect controller change and refresh the page
    sw.addEventListener("controllerchange", () => {
      reload();
    });

    if (reg.active) {
      doc.querySelectorAll("script[type='module/hot']").forEach(
        (el) => {
          const copy = el.cloneNode(true) as HTMLScriptElement;
          copy.type = "module";
          el.replaceWith(copy);
        },
      );
      console.log("[hot] Service Worker active");
    }

    let refreshing = false;
    function reload() {
      if (!refreshing) {
        refreshing = true;
        location.reload();
      }
    }
  }
}

// 🔥
const hot = new Hot();

// sw environment
if (!doc) {
  const mimeTypes: Record<string, string[]> = {
    "a/gzip": ["gz"],
    "a/javascript": ["js", "mjs"],
    "a/json": ["json", "map"],
    "a/wasm": ["wasm"],
    "a/xml": ["xml"],
    "i/jpeg": ["jpeg", "jpg"],
    "i/png": ["png"],
    "i/svg+xml": ["svg"],
    "t/css": ["css"],
    "t/csv": ["csv"],
    "t/html": ["html", "htm"],
    "t/plain": ["txt", "glsl"],
    "t/yaml": ["yaml", "yml"],
  };
  const alias: Record<string, string> = {
    a: "application",
    i: "image",
    t: "text",
  };
  const typesMap = new Map<string, string>();
  for (const contentType in mimeTypes) {
    for (const ext of mimeTypes[contentType]) {
      typesMap.set(ext, alias[contentType.charAt(0)] + contentType.slice(1));
    }
  }

  let hotCache: Cache | null = null;
  const cacheFetch = async (req: Request) => {
    if (req.method !== "GET") {
      return fetch(req);
    }
    const cache = hotCache ?? (hotCache = await caches.open("hot/v" + VERSION));
    let res = await cache.match(req);
    if (res) {
      return res;
    }
    res = await fetch(req);
    if (!res.ok) {
      return res;
    }
    cache.put(req, res.clone());
    return res;
  };

  const serveVFS = async (url: URL) => {
    const name = url.pathname.slice(5);
    const file = await vfs.get(name);
    if (!file) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file.data, {
      status: 200,
      headers: { "Content-Type": typesMap.get(getExtname(name)) ?? "" },
    });
  };

  const jsType = typesMap.get("js") + ";charset=utf-8";
  const serveModule = async (url: URL, lang: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      return res;
    }
    const im = await vfs.get("importmap.json");
    const importMap: { imports?: Record<string, string> } = parse(
      im?.data ? (isString(im.data) ? im.data : dec.decode(im.data)) : "{}",
    );
    const source = await res.text();
    const hash = await computeHash(
      enc.encode((importMap.imports?.[kJsxImportSource] ?? "") + source),
    );
    const cached = await vfs.get(url.href);
    if (cached && cached.hash === hash) {
      return new Response(cached.data, { headers: { "Content-Type": jsType } });
    }
    const isDev = new URL(import.meta.url).hostname === "localhost";
    let ret: { code: string; map?: string };
    try {
      if (lang === "vue") {
        ret = await vue(url, source, { importMap, isDev });
      } else {
        ret = await tsx(url, source, { lang, importMap, isDev });
      }
    } catch (err) {
      console.error(err);
      return new Response(err.message, { status: 500 });
    }
    let body = ret.code;
    if (ret.map) {
      body +=
        "\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,";
      body += btoa(ret.map);
    }
    await vfs.put(url.href, hash, body);
    return new Response(body, { headers: { "Content-Type": jsType } });
  };

  self.addEventListener("fetch", (event) => {
    const evt = event as FetchEvent;
    const url = new URL(evt.request.url);
    if (url.hostname === "esm.sh") {
      if (url.pathname.startsWith("/hot/")) {
        evt.respondWith(serveVFS(url));
      } else {
        evt.respondWith(cacheFetch(evt.request));
      }
    } else {
      const lang = getExtname(url.pathname);
      if (lang === "jsx" || lang === "ts" || lang === "tsx" || lang === "vue") {
        evt.respondWith(serveModule(url, lang));
      }
    }
  });

  self.addEventListener("message", (event) => {
    switch (event.data.type) {
      case kSkipWaiting:
        // @ts-ignore
        self.skipWaiting();
        break;
    }
  });
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function getExtname(s: string): string {
  const i = s.lastIndexOf(".");
  if (i >= 0) {
    return s.slice(i + 1);
  }
  return "";
}

async function computeHash(input: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  return [...buffer].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function featureDisabled(name: string): any {
  return () => Promise.reject(new Error(`Feature ${name} is disabled.`));
}

export default hot;
