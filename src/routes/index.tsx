import {
  component$,
  useSignal,
  useStore,
  useComputed$,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { isServer } from "@builder.io/qwik/build";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  type Article,
  fetchArticles,
  fetchArticle,
  saveArticle,
  deleteArticle,
} from "../lib/api";

const parseTags = (input: string) => [
  ...new Set(
    input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  ),
];

// Editor state fingerprint, used to detect unsaved changes.
const snap = (a: Article, tags: string) =>
  JSON.stringify([a.slug, a.title, a.description, a.body, a.published, tags]);

interface DraftArticle {
  slug: string;
  title: string;
  description: string;
  body: string;
  published: boolean;
  tagsInput: string;
  isEditMode: boolean;
  savedAt: string;
}

const DRAFT_KEY = "tana_draft_article";

const clearStoredDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage unavailable
  }
};

type StatusKind = "info" | "warn" | "error";

const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
};

const Icon = (p: { d: string }) => (
  <svg
    class="ico"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={p.d} />
  </svg>
);

export default component$(() => {
  const apiBase = useSignal("http://127.0.0.1:5555");
  const apiToken = useSignal("");
  const statusMessage = useSignal("");
  const statusKind = useSignal<StatusKind>("info");
  const conn = useSignal<"idle" | "ok" | "error">("idle");
  const filter = useSignal("");
  const settingsRef = useSignal<HTMLDialogElement>();
  const draftRef = useSignal<HTMLDialogElement>();
  const pendingDraft = useSignal<DraftArticle | null>(null);
  const lastDraftSavedAt = useSignal("");
  // Shown under the title in the preview, like the live site does.
  const createdAt = useSignal("");
  const isLoading = useSignal(false);

  const articles = useSignal<Article[]>([]);
  const isEditMode = useSignal(false);
  const activeTab = useSignal<"editor" | "preview">("editor");
  const showSidebar = useSignal(false);

  const currentArticle = useStore<Article>({
    slug: "",
    title: "",
    description: "",
    body: "",
    published: true,
    tags: [],
  });

  const tagsInput = useSignal("");
  const savedSnapshot = useSignal(snap({ ...currentArticle, tags: [] }, ""));
  const isDirty = useComputed$(
    () => snap(currentArticle, tagsInput.value) !== savedSnapshot.value,
  );
  // Only the latest selectArticle response may touch the editor.
  const selectReq = useSignal(0);

  const renderedHtml = useComputed$(() => {
    const body = currentArticle.body || ""; // read before return so it's tracked
    if (isServer) return ""; // DOMPurify needs a window
    try {
      return DOMPurify.sanitize(marked.parse(body) as string);
    } catch {
      return "";
    }
  });

  const visibleArticles = useComputed$(() => {
    const q = filter.value.trim().toLowerCase();
    return q
      ? articles.value.filter(
          (a) =>
            a.title.toLowerCase().includes(q) ||
            a.slug.toLowerCase().includes(q),
        )
      : articles.value;
  });

  const counts = useComputed$(() => {
    const t = (currentArticle.body || "").trim();
    return {
      words: t ? t.split(/\s+/).length : 0,
      chars: t.replace(/\s/g, "").length,
    };
  });

  const setStatus = $((msg: string, kind: StatusKind = "info") => {
    statusMessage.value = msg;
    statusKind.value = kind;
  });

  const restoreDraft = $(() => {
    const d = pendingDraft.value;
    draftRef.value?.close();
    pendingDraft.value = null;
    if (!d) return;
    selectReq.value++; // drop any in-flight selectArticle
    currentArticle.slug = d.slug || "";
    currentArticle.title = d.title || "";
    currentArticle.description = d.description || "";
    currentArticle.body = d.body || "";
    currentArticle.published = d.published ?? true;
    createdAt.value = "";
    tagsInput.value = d.tagsInput || "";
    isEditMode.value = d.isEditMode ?? false;
    setStatus("Restored draft from previous session.");
  });

  const discardDraft = $(() => {
    clearStoredDraft();
    draftRef.value?.close();
    pendingDraft.value = null;
    lastDraftSavedAt.value = "";
    setStatus("Draft discarded.");
  });

  const loadList = $(async (quiet = false) => {
    try {
      isLoading.value = true;
      if (!quiet) await setStatus("Loading articles...");
      const list = await fetchArticles(apiBase.value, apiToken.value);
      articles.value = list;
      conn.value = "ok";
      if (!quiet) setStatus(`Loaded ${list.length} articles.`);
    } catch (e: any) {
      conn.value = "error";
      setStatus(`Failed to fetch articles: ${e.message}`, "error");
    } finally {
      isLoading.value = false;
    }
  });

  const selectArticle = $(async (slug: string) => {
    if (
      isDirty.value &&
      !confirm("未保存の変更があります。破棄して別の記事を開きますか？")
    )
      return;
    const req = ++selectReq.value;
    try {
      isLoading.value = true;
      await setStatus(`Loading ${slug}...`);
      const art = await fetchArticle(apiBase.value, apiToken.value, slug);
      if (req !== selectReq.value) return;
      currentArticle.slug = art.slug;
      currentArticle.title = art.title;
      currentArticle.description = art.description || "";
      currentArticle.body = art.body || "";
      currentArticle.published = Boolean(art.published);
      currentArticle.tags = art.tags || [];
      createdAt.value = art.createdAt || "";
      tagsInput.value = (art.tags || []).join(", ");
      savedSnapshot.value = snap(currentArticle, tagsInput.value);
      clearStoredDraft();
      lastDraftSavedAt.value = "";
      isEditMode.value = true;
      showSidebar.value = false;
      setStatus(`Opened ${slug}`);
    } catch (e: any) {
      if (req !== selectReq.value) return;
      setStatus(`Error loading article: ${e.message}`, "error");
    } finally {
      if (req === selectReq.value) isLoading.value = false;
    }
  });

  const clearEditor = $(() => {
    selectReq.value++; // drop any in-flight selectArticle
    isLoading.value = false;
    currentArticle.slug = "";
    currentArticle.title = "";
    currentArticle.description = "";
    currentArticle.body = "";
    currentArticle.published = true;
    currentArticle.tags = [];
    createdAt.value = "";
    tagsInput.value = "";
    savedSnapshot.value = snap(currentArticle, "");
    clearStoredDraft();
    lastDraftSavedAt.value = "";
    isEditMode.value = false;
    showSidebar.value = false;
  });

  const newArticle = $(async () => {
    if (
      isDirty.value &&
      !confirm("未保存の変更があります。破棄して新規作成しますか？")
    )
      return;
    await clearEditor();
    setStatus("New draft created.");
  });

  const handleSave = $(async () => {
    if (isLoading.value) return;
    const slug = currentArticle.slug.trim();
    const title = currentArticle.title.trim();
    if (!slug || !title) {
      setStatus("Slug and Title are required.", "error");
      return;
    }
    if (/[\s/]/.test(slug)) {
      setStatus('Slug must not contain whitespace or "/".', "error");
      return;
    }
    currentArticle.slug = slug;
    currentArticle.title = title;

    try {
      isLoading.value = true;
      await setStatus("Saving...");
      currentArticle.tags = parseTags(tagsInput.value);

      await saveArticle(
        apiBase.value,
        apiToken.value,
        currentArticle,
        isEditMode.value,
      );
      tagsInput.value = currentArticle.tags.join(", ");
      savedSnapshot.value = snap(currentArticle, tagsInput.value);
      clearStoredDraft();
      lastDraftSavedAt.value = "";
      isEditMode.value = true;
      await loadList(true);
      setStatus(
        currentArticle.published
          ? `Saved "${currentArticle.title}" successfully!`
          : `Saved "${currentArticle.title}" as draft.`,
      );
    } catch (e: any) {
      setStatus(`Save failed: ${e.message} (Draft preserved locally)`, "error");
    } finally {
      isLoading.value = false;
    }
  });

  const handleDelete = $(async () => {
    if (!currentArticle.slug) return;
    if (!confirm(`Delete "${currentArticle.slug}"?`)) return;

    try {
      isLoading.value = true;
      await setStatus("Deleting...");
      await deleteArticle(apiBase.value, apiToken.value, currentArticle.slug);
      const deleted = currentArticle.slug;
      await clearEditor();
      await loadList(true);
      setStatus(`Deleted ${deleted}.`);
    } catch (e: any) {
      setStatus(`Delete failed: ${e.message}`, "error");
    } finally {
      isLoading.value = false;
    }
  });

  // Client-side initialization for localStorage persistence
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup }) => {
    const savedUrl = localStorage.getItem("tana_api_url");
    const savedToken = localStorage.getItem("tana_api_token");
    if (savedUrl) apiBase.value = savedUrl;
    if (savedToken) apiToken.value = savedToken;

    // Esc must not dismiss the recovery dialog: the user has to pick.
    const keepOpen = (e: Event) => e.preventDefault();
    draftRef.value?.addEventListener("cancel", keepOpen);
    cleanup(() => draftRef.value?.removeEventListener("cancel", keepOpen));

    // Offer to recover a draft left over from a previous session.
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as DraftArticle;
        if (d && (d.title || d.body || d.slug)) {
          pendingDraft.value = d;
          draftRef.value?.showModal();
        } else {
          clearStoredDraft();
        }
      }
    } catch {
      clearStoredDraft(); // corrupt entry
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    cleanup(() => window.removeEventListener("keydown", onKeyDown));

    await loadList();
  });

  // Warn before closing the tab while there are unsaved changes.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    if (!track(() => isDirty.value)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    cleanup(() => window.removeEventListener("beforeunload", onBeforeUnload));
  });

  // Auto-save: mirror unsaved editor state to localStorage. Clean state never
  // touches storage, so a pending recovery draft survives until it is resolved.
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    const current = track(() => snap(currentArticle, tagsInput.value));
    if (current === savedSnapshot.value) return;
    if (!currentArticle.slug && !currentArticle.title && !currentArticle.body)
      return;
    const draft: DraftArticle = {
      slug: currentArticle.slug,
      title: currentArticle.title,
      description: currentArticle.description,
      body: currentArticle.body,
      published: currentArticle.published,
      tagsInput: tagsInput.value,
      isEditMode: isEditMode.value,
      savedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      lastDraftSavedAt.value = new Date().toLocaleTimeString();
    } catch (e) {
      console.error("Failed to save draft to localStorage:", e);
    }
  });

  const updateApiBase = $((val: string) => {
    apiBase.value = val;
    localStorage.setItem("tana_api_url", val);
  });

  const updateApiToken = $((val: string) => {
    apiToken.value = val;
    localStorage.setItem("tana_api_token", val);
  });

  return (
    <div class="app-container">
      <header class="topbar">
        <button
          class="btn ghost icon mobile-toggle-btn"
          onClick$={() => (showSidebar.value = !showSidebar.value)}
          aria-label="Toggle article list"
          aria-expanded={showSidebar.value}
        >
          <Icon d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
        </button>
        <div class="brand">Tana</div>

        <div class="doc">
          <span class="doc-name">
            {isEditMode.value ? currentArticle.slug : "New draft"}
          </span>
          {isDirty.value && (
            <span class="dirty" title="Unsaved changes">
              <i aria-hidden="true" />
              <span class="dirty-label">Unsaved</span>
              {lastDraftSavedAt.value && (
                <span class="dirty-label draft-time">
                  / draft saved {lastDraftSavedAt.value}
                </span>
              )}
            </span>
          )}
        </div>

        <div class="actions">
          <button
            class="btn ghost"
            onClick$={newArticle}
            aria-label="New article"
          >
            <Icon d="M8 3v10M3 8h10" />
            <span class="lbl">New</span>
          </button>
          {isEditMode.value && (
            <button
              class="btn ghost danger"
              onClick$={handleDelete}
              disabled={isLoading.value}
              aria-label="Delete article"
            >
              <Icon d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />
              <span class="lbl">Delete</span>
            </button>
          )}
          <button
            class="btn ghost icon"
            onClick$={() => settingsRef.value?.showModal()}
            aria-label="Settings"
            title="Settings"
          >
            <Icon d="M2.5 5h6M11.5 5h2M2.5 11h2M7.5 11h6M9 3.5v3M6 9.5v3" />
          </button>
          <button
            class="btn primary"
            onClick$={handleSave}
            disabled={isLoading.value}
            title="Ctrl+S or Cmd+S"
          >
            <span>{isEditMode.value ? "Update" : "Create"}</span>
            <kbd>Ctrl S</kbd>
          </button>
        </div>
      </header>

      <dialog
        class="settings"
        ref={settingsRef}
        aria-labelledby="settings-title"
        onClick$={(e, el) => {
          if (e.target === el) el.close();
        }}
      >
        <form method="dialog">
          <h2 id="settings-title">Settings</h2>
          <label class="field-stack">
            <span>API URL</span>
            <input
              type="text"
              inputMode="url"
              autoComplete="off"
              spellcheck={false}
              placeholder="http://127.0.0.1:5555"
              value={apiBase.value}
              onInput$={(e) =>
                updateApiBase((e.target as HTMLInputElement).value)
              }
            />
          </label>
          <label class="field-stack">
            <span>Bearer token</span>
            <input
              type="password"
              autoComplete="off"
              placeholder="Optional"
              value={apiToken.value}
              onInput$={(e) =>
                updateApiToken((e.target as HTMLInputElement).value)
              }
            />
          </label>
          <p class="hint">Both values are stored in this browser only.</p>
          <div class="dialog-actions">
            <span class={`conn ${conn.value}`} role="status">
              <i aria-hidden="true" />
              {conn.value === "ok"
                ? "Connected"
                : conn.value === "error"
                  ? "Connection failed"
                  : "Not synced yet"}
            </span>
            <button
              type="button"
              class="btn"
              onClick$={() => loadList()}
              disabled={isLoading.value}
            >
              Sync
            </button>
            <button class="btn primary">Done</button>
          </div>
        </form>
      </dialog>

      <dialog class="recover" ref={draftRef} aria-labelledby="recover-title">
        <h2 id="recover-title">未保存の下書きが見つかりました</h2>
        <p class="hint">
          前回の編集セッションで保存されていない下書きがあります。復元しますか？
        </p>
        {pendingDraft.value && (
          <div class="draft-preview">
            <div class="draft-title">
              {pendingDraft.value.title || "（タイトルなし）"}
              <span class="draft-meta">
                {" "}
                ({pendingDraft.value.slug || "slug未設定"})
              </span>
            </div>
            <div class="draft-meta">
              保存日時:{" "}
              {pendingDraft.value.savedAt
                ? new Date(pendingDraft.value.savedAt).toLocaleString()
                : "不明"}
            </div>
            {pendingDraft.value.body && (
              <div class="draft-excerpt">
                {pendingDraft.value.body.slice(0, 150)}
                {pendingDraft.value.body.length > 150 ? "..." : ""}
              </div>
            )}
          </div>
        )}
        <div class="dialog-actions end">
          <button class="btn danger" onClick$={discardDraft}>
            破棄する (Discard)
          </button>
          <button class="btn primary" onClick$={restoreDraft}>
            下書きを復元 (Restore)
          </button>
        </div>
      </dialog>

      {/* Mobile sub-bar: Switch tabs */}
      <div class="mobile-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab.value === "editor"}
          class={`tab-btn ${activeTab.value === "editor" ? "active" : ""}`}
          onClick$={() => (activeTab.value = "editor")}
        >
          Editor
        </button>
        <button
          role="tab"
          aria-selected={activeTab.value === "preview"}
          class={`tab-btn ${activeTab.value === "preview" ? "active" : ""}`}
          onClick$={() => (activeTab.value = "preview")}
        >
          Preview
        </button>
      </div>

      <main class="main-layout">
        {/* Backdrop for mobile drawer */}
        {showSidebar.value && (
          <div
            class="sidebar-backdrop"
            onClick$={() => (showSidebar.value = false)}
          />
        )}

        <aside class={`sidebar ${showSidebar.value ? "open" : ""}`}>
          <div class="sidebar-header">
            <span>
              Articles <span class="count">{articles.value.length}</span>
            </span>
            <button
              class="btn ghost icon close-btn"
              onClick$={() => (showSidebar.value = false)}
              aria-label="Close article list"
            >
              <Icon d="M4 4l8 8M12 4l-8 8" />
            </button>
          </div>
          {articles.value.length > 0 && (
            <input
              type="search"
              class="filter"
              placeholder="Filter by title or slug"
              aria-label="Filter articles"
              value={filter.value}
              onInput$={(e) =>
                (filter.value = (e.target as HTMLInputElement).value)
              }
            />
          )}
          <ul class="article-list">
            {visibleArticles.value.map((a) => {
              const active = currentArticle.slug === a.slug && isEditMode.value;
              const date = fmtDate(a.createdAt);
              return (
                <li key={a.slug} class={active ? "active" : ""}>
                  <button
                    class="art-item"
                    aria-current={active ? "true" : undefined}
                    onClick$={() => selectArticle(a.slug)}
                  >
                    <span class="art-title">{a.title}</span>
                    <span class="art-sub">
                      <span class="art-slug">{a.slug}</span>
                      {a.published === false && (
                        <span class="art-draft">Draft</span>
                      )}
                      {date && <span class="art-date">{date}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {articles.value.length === 0 && (
            <div class="empty">
              <p class="empty-title">No articles</p>
              <p>
                Set the API URL in settings, then sync to load your articles.
                {!apiToken.value && " Drafts are only listed with a token."}
              </p>
              <button
                class="btn"
                onClick$={() => settingsRef.value?.showModal()}
              >
                Open settings
              </button>
            </div>
          )}
          {articles.value.length > 0 && visibleArticles.value.length === 0 && (
            <div class="empty">
              <p class="empty-title">No matches</p>
              <p>Nothing matches "{filter.value}".</p>
            </div>
          )}
        </aside>

        <section class="content-area">
          {/* Left Editor */}
          <div
            class={`editor-pane ${
              activeTab.value !== "editor" ? "mobile-hidden" : ""
            }`}
          >
            <input
              type="text"
              class="title-input"
              placeholder="Untitled"
              aria-label="Title"
              value={currentArticle.title}
              onInput$={(e) =>
                (currentArticle.title = (e.target as HTMLInputElement).value)
              }
            />
            <div class="meta">
              <div class="meta-row">
                <label class="field">
                  <span>Slug</span>
                  <input
                    type="text"
                    placeholder="hello-world"
                    value={currentArticle.slug}
                    disabled={isEditMode.value}
                    onInput$={(e) =>
                      (currentArticle.slug = (
                        e.target as HTMLInputElement
                      ).value)
                    }
                  />
                </label>
                <label class="field">
                  <span>Tags</span>
                  <input
                    type="text"
                    placeholder="comma, separated"
                    value={tagsInput.value}
                    onInput$={(e) =>
                      (tagsInput.value = (e.target as HTMLInputElement).value)
                    }
                  />
                </label>
              </div>
              <div class="meta-row">
                <label class="field">
                  <span>Summary</span>
                  <input
                    type="text"
                    placeholder="One line shown under the title"
                    value={currentArticle.description}
                    onInput$={(e) =>
                      (currentArticle.description = (
                        e.target as HTMLInputElement
                      ).value)
                    }
                  />
                </label>
                <label class="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={currentArticle.published}
                    onChange$={(e) =>
                      (currentArticle.published = (
                        e.target as HTMLInputElement
                      ).checked)
                    }
                  />
                  <span class="track" aria-hidden="true" />
                  <span>Published</span>
                </label>
              </div>
            </div>
            <textarea
              placeholder="Write Markdown here..."
              aria-label="Markdown body"
              value={currentArticle.body}
              onInput$={(e) =>
                (currentArticle.body = (e.target as HTMLTextAreaElement).value)
              }
            />
          </div>

          {/* Right Preview */}
          <div
            lang="ja"
            class={`preview-pane ${
              activeTab.value !== "preview" ? "mobile-hidden" : ""
            }`}
          >
            <div class="site-scroll">
              <div class="site-body">
                <div class="card">
                  <div class="article">
                    <div class="article-pre">
                      <h1>{currentArticle.title || "Untitled"}</h1>
                      <p class="font-mono text-gray-500">
                        {createdAt.value || "\u00a0"}
                      </p>
                    </div>
                    <main
                      class="article-main"
                      dangerouslySetInnerHTML={renderedHtml.value}
                    />
                  </div>
                  <hr class="hr1" />
                  <span class="back-link">記事一覧 ↩️</span>
                  <hr class="hr2" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer class="statusline">
        <div class={`msg ${statusKind.value}`} role="status">
          {statusMessage.value && <i aria-hidden="true" />}
          <span>{statusMessage.value}</span>
        </div>
        <div class="stats">
          <span class={`conn ${conn.value}`}>
            <i aria-hidden="true" />
            <span class="conn-label">
              {conn.value === "ok"
                ? "Connected"
                : conn.value === "error"
                  ? "Offline"
                  : "Not synced"}
            </span>
          </span>
          <span>{counts.value.chars.toLocaleString()} chars</span>
          <span class="stat-words">
            {counts.value.words.toLocaleString()} words
          </span>
        </div>
      </footer>
    </div>
  );
});

export const head: DocumentHead = {
  title: "TanaWeb Editor",
  meta: [
    {
      name: "description",
      content: "Minimalist WebUI for Tana CMS",
    },
  ],
};
