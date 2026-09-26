import {
  component$,
  useSignal,
  useStore,
  useComputed$,
  useVisibleTask$,
  $,
} from "@builder.io/qwik";
import type { DocumentHead } from "@builder.io/qwik-city";
import { marked } from "marked";
import {
  type Article,
  fetchArticles,
  fetchArticle,
  saveArticle,
  deleteArticle,
} from "../lib/api";

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

export default component$(() => {
  const apiBase = useSignal("http://127.0.0.1:5555");
  const apiToken = useSignal("");
  const statusMessage = useSignal("");
  const isError = useSignal(false);
  const isLoading = useSignal(false);

  const articles = useSignal<Article[]>([]);
  const isEditMode = useSignal(false);

  const currentArticle = useStore<Article>({
    slug: "",
    title: "",
    description: "",
    body: "",
    published: true,
    tags: [],
  });

  const tagsInput = useSignal("");
  const isDirty = useSignal(false);
  const lastDraftSavedAt = useSignal("");
  const showDraftModal = useSignal(false);
  const pendingDraft = useSignal<DraftArticle | null>(null);

  const renderedHtml = useComputed$(() => {
    try {
      return marked.parse(currentArticle.body || "") as string;
    } catch {
      return "";
    }
  });

  const setStatus = $((msg: string, error = false) => {
    statusMessage.value = msg;
    isError.value = error;
  });

  const saveDraft = $(() => {
    // Only save draft if there is meaningful content
    if (!currentArticle.slug && !currentArticle.title && !currentArticle.body) {
      return;
    }
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
      isDirty.value = true;
      lastDraftSavedAt.value = new Date().toLocaleTimeString();
    } catch (e) {
      console.error("Failed to save draft to localStorage:", e);
    }
  });

  const clearDraft = $(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      console.error("Failed to remove draft:", e);
    }
    isDirty.value = false;
    lastDraftSavedAt.value = "";
  });

  const restoreDraft = $(() => {
    if (!pendingDraft.value) return;
    const d = pendingDraft.value;
    currentArticle.slug = d.slug || "";
    currentArticle.title = d.title || "";
    currentArticle.description = d.description || "";
    currentArticle.body = d.body || "";
    currentArticle.published = d.published ?? true;
    tagsInput.value = d.tagsInput || "";
    isEditMode.value = d.isEditMode ?? false;
    isDirty.value = true;
    lastDraftSavedAt.value = d.savedAt
      ? new Date(d.savedAt).toLocaleTimeString()
      : "Restored";
    showDraftModal.value = false;
    setStatus("Restored draft from previous session.");
  });

  const discardDraft = $(() => {
    clearDraft();
    pendingDraft.value = null;
    showDraftModal.value = false;
    setStatus("Draft discarded.");
  });

  const loadList = $(async () => {
    try {
      isLoading.value = true;
      setStatus("Loading articles...");
      const list = await fetchArticles(apiBase.value);
      articles.value = list;
      setStatus(`Loaded ${list.length} articles.`);
    } catch (e: any) {
      setStatus(`Failed to fetch articles: ${e.message}`, true);
    } finally {
      isLoading.value = false;
    }
  });

  const selectArticle = $(async (slug: string) => {
    if (
      isDirty.value &&
      currentArticle.slug !== slug &&
      !confirm("未保存の変更があります。破棄して別の記事を開きますか？")
    ) {
      return;
    }
    clearDraft();

    try {
      isLoading.value = true;
      setStatus(`Loading ${slug}...`);
      const art = await fetchArticle(apiBase.value, slug);
      currentArticle.slug = art.slug;
      currentArticle.title = art.title;
      currentArticle.description = art.description || "";
      currentArticle.body = art.body || "";
      currentArticle.published = Boolean(art.published);
      currentArticle.tags = art.tags || [];
      tagsInput.value = (art.tags || []).join(", ");
      isEditMode.value = true;
      isDirty.value = false;
      setStatus(`Opened ${slug}`);
    } catch (e: any) {
      setStatus(`Error loading article: ${e.message}`, true);
    } finally {
      isLoading.value = false;
    }
  });

  const newArticle = $(() => {
    if (
      isDirty.value &&
      !confirm("未保存の変更があります。破棄して新規作成しますか？")
    ) {
      return;
    }
    clearDraft();

    currentArticle.slug = "";
    currentArticle.title = "";
    currentArticle.description = "";
    currentArticle.body = "";
    currentArticle.published = true;
    currentArticle.tags = [];
    tagsInput.value = "";
    isEditMode.value = false;
    isDirty.value = false;
    setStatus("New draft created.");
  });

  const handleSave = $(async () => {
    if (!currentArticle.slug || !currentArticle.title) {
      setStatus("Slug and Title are required.", true);
      return;
    }

    try {
      isLoading.value = true;
      setStatus("Saving...");
      currentArticle.tags = tagsInput.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      await saveArticle(
        apiBase.value,
        apiToken.value,
        currentArticle,
        isEditMode.value,
      );
      setStatus(`Saved "${currentArticle.title}" successfully!`);
      isEditMode.value = true;
      clearDraft();
      await loadList();
    } catch (e: any) {
      setStatus(`Save failed: ${e.message} (Draft preserved locally)`, true);
    } finally {
      isLoading.value = false;
    }
  });

  const handleDelete = $(async () => {
    if (!currentArticle.slug) return;
    if (!confirm(`Delete "${currentArticle.slug}"?`)) return;

    try {
      isLoading.value = true;
      setStatus("Deleting...");
      await deleteArticle(apiBase.value, apiToken.value, currentArticle.slug);
      setStatus(`Deleted ${currentArticle.slug}.`);
      clearDraft();
      newArticle();
      await loadList();
    } catch (e: any) {
      setStatus(`Delete failed: ${e.message}`, true);
    } finally {
      isLoading.value = false;
    }
  });

  // Client-side initialization for localStorage persistence and draft checking
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async () => {
    const savedUrl = localStorage.getItem("tana_api_url");
    const savedToken = localStorage.getItem("tana_api_token");
    if (savedUrl) apiBase.value = savedUrl;
    if (savedToken) apiToken.value = savedToken;

    // Check for existing uncommitted draft
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft) {
      try {
        const parsed = JSON.parse(savedDraft) as DraftArticle;
        if (parsed && (parsed.title || parsed.body || parsed.slug)) {
          pendingDraft.value = parsed;
          showDraftModal.value = true;
        }
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }
    }

    await loadList();
  });

  // Warn on page unload if changes are unsaved
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty.value) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    cleanup(() => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    });
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
      {showDraftModal.value && pendingDraft.value && (
        <div class="modal-backdrop">
          <div class="modal-content">
            <h2>未保存の下書きが見つかりました</h2>
            <p>
              前回の編集セッションで保存されていない下書きがあります。復元しますか？
            </p>
            <div class="draft-preview">
              <div class="draft-title">
                {pendingDraft.value.title || "（タイトルなし）"}{" "}
                <span class="draft-meta">
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
            <div class="modal-actions">
              <button class="danger" onClick$={discardDraft}>
                破棄する (Discard)
              </button>
              <button class="primary" onClick$={restoreDraft}>
                下書きを復元 (Restore)
              </button>
            </div>
          </div>
        </div>
      )}

      <header class="topbar">
        <div class="brand">
          <span>Tana Web</span>
        </div>
        <div class="config-bar">
          <input
            type="text"
            class="api-url"
            placeholder="API URL"
            value={apiBase.value}
            onInput$={(e) =>
              updateApiBase((e.target as HTMLInputElement).value)
            }
          />
          <input
            type="password"
            class="api-token"
            placeholder="Bearer Token"
            value={apiToken.value}
            onInput$={(e) =>
              updateApiToken((e.target as HTMLInputElement).value)
            }
          />
          <button onClick$={loadList} disabled={isLoading.value}>
            Sync
          </button>
        </div>
        <div class="actions">
          {lastDraftSavedAt.value && (
            <span
              class="draft-indicator saved"
              title="ブラウザに自動退避されています"
            >
              ✓ Draft saved {lastDraftSavedAt.value}
            </span>
          )}
          <button onClick$={newArticle}>New</button>
          {isEditMode.value && (
            <button
              class="danger"
              onClick$={handleDelete}
              disabled={isLoading.value}
            >
              Delete
            </button>
          )}
          <button
            class="primary"
            onClick$={handleSave}
            disabled={isLoading.value}
          >
            {isEditMode.value ? "Update" : "Create"}
          </button>
        </div>
      </header>

      {statusMessage.value && (
        <div class={`status-bar ${isError.value ? "error" : "info"}`}>
          {statusMessage.value}
        </div>
      )}

      <main class="main-layout">
        <aside class="sidebar">
          <div class="sidebar-header">
            <span>Articles ({articles.value.length})</span>
          </div>
          <ul class="article-list">
            {articles.value.map((a) => (
              <li
                key={a.slug}
                class={
                  currentArticle.slug === a.slug && isEditMode.value
                    ? "active"
                    : ""
                }
                onClick$={() => selectArticle(a.slug)}
              >
                <div class="art-title">{a.title}</div>
                <div class="art-slug">{a.slug}</div>
              </li>
            ))}
          </ul>
        </aside>

        <section class="content-area">
          {/* Left Editor */}
          <div class="editor-pane">
            <div class="meta-fields">
              <div class="row">
                <input
                  type="text"
                  placeholder="Slug (e.g. hello-world)"
                  value={currentArticle.slug}
                  disabled={isEditMode.value}
                  onInput$={(e) => {
                    currentArticle.slug = (
                      e.target as HTMLInputElement
                    ).value;
                    saveDraft();
                  }}
                />
                <input
                  type="text"
                  placeholder="Title"
                  value={currentArticle.title}
                  onInput$={(e) => {
                    currentArticle.title = (
                      e.target as HTMLInputElement
                    ).value;
                    saveDraft();
                  }}
                />
              </div>
              <input
                type="text"
                placeholder="Description"
                value={currentArticle.description}
                onInput$={(e) => {
                  currentArticle.description = (
                    e.target as HTMLInputElement
                  ).value;
                  saveDraft();
                }}
              />
              <div class="row">
                <input
                  type="text"
                  placeholder="Tags (comma separated)"
                  value={tagsInput.value}
                  onInput$={(e) => {
                    tagsInput.value = (
                      e.target as HTMLInputElement
                    ).value;
                    saveDraft();
                  }}
                />
                <label class="checkbox-row">
                  <input
                    type="checkbox"
                    checked={currentArticle.published}
                    onChange$={(e) => {
                      currentArticle.published = (
                        e.target as HTMLInputElement
                      ).checked;
                      saveDraft();
                    }}
                  />
                  Published
                </label>
              </div>
            </div>
            <textarea
              placeholder="Write Markdown here..."
              value={currentArticle.body}
              onInput$={(e) => {
                currentArticle.body = (
                  e.target as HTMLTextAreaElement
                ).value;
                saveDraft();
              }}
            />
          </div>

          {/* Right Preview */}
          <div class="preview-pane">
            <div class="preview-header">
              <h1>{currentArticle.title || "Untitled"}</h1>
              {currentArticle.description && (
                <p class="desc">{currentArticle.description}</p>
              )}
              {tagsInput.value && (
                <div class="tags">
                  {tagsInput.value
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .map((t) => (
                      <span key={t} class="tag">
                        #{t}
                      </span>
                    ))}
                </div>
              )}
            </div>
            <div
              class="preview-body"
              dangerouslySetInnerHTML={renderedHtml.value}
            />
          </div>
        </section>
      </main>
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
