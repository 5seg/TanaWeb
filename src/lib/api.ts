export interface Article {
  slug: string;
  title: string;
  description: string;
  body: string;
  published: boolean;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ArticlesResponse {
  data: Article[];
  meta: { total: number };
}

const base = (apiBase: string) => apiBase.replace(/\/$/, "");

// Parse JSON safely; throw "HTTP <status>: <server error>" on failure or non-JSON body.
async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // not JSON (HTML error page, etc.)
  }
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}: ${json?.error || res.statusText || "request failed"}`,
    );
  }
  if (json === null) throw new Error(`HTTP ${res.status}: response was not JSON`);
  return json as T;
}

// No header at all when the token is blank (servers that need no auth).
const auth = (token: string): Record<string, string> =>
  token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {};

const PAGE = 100;

// With a token, use the Bearer-protected /api endpoints (includes unpublished
// drafts); without one, fall back to the public endpoints (published only).
export async function fetchArticles(apiBase: string, token: string): Promise<Article[]> {
  const authed = Boolean(token.trim());
  const all: Article[] = [];
  let total = 0;
  do {
    const res = await fetch(
      `${base(apiBase)}${authed ? "/api" : ""}/articles?limit=${PAGE}&offset=${all.length}`,
      authed ? { headers: auth(token) } : undefined,
    );
    const page = await parse<ArticlesResponse>(res);
    total = page.meta.total;
    if (!page.data.length) break;
    all.push(...page.data);
  } while (all.length < total);
  return all;
}

export async function fetchArticle(
  apiBase: string,
  token: string,
  slug: string
): Promise<Article> {
  const authed = Boolean(token.trim());
  const res = await fetch(
    `${base(apiBase)}${authed ? "/api" : ""}/articles/${encodeURIComponent(slug)}`,
    authed ? { headers: auth(token) } : undefined,
  );
  return parse<Article>(res);
}

export async function saveArticle(
  apiBase: string,
  token: string,
  article: Article,
  isEdit: boolean
): Promise<{ ok: boolean; slug?: string }> {
  const url = isEdit
    ? `${base(apiBase)}/api/articles/${encodeURIComponent(article.slug)}`
    : `${base(apiBase)}/api/articles`;

  const method = isEdit ? "PUT" : "POST";
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...auth(token),
    },
    body: JSON.stringify({
      slug: article.slug,
      title: article.title,
      description: article.description,
      body: article.body,
      published: article.published,
      tags: article.tags,
    }),
  });
  return parse(res);
}

export async function deleteArticle(
  apiBase: string,
  token: string,
  slug: string
): Promise<{ ok: boolean }> {
  const res = await fetch(`${base(apiBase)}/api/articles/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers: auth(token),
  });
  return parse(res);
}
