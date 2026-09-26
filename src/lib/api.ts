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

export async function fetchArticles(apiBase: string): Promise<Article[]> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/articles?limit=100&offset=0`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data = (await res.json()) as ArticlesResponse;
  return data.data;
}

export async function fetchArticle(apiBase: string, slug: string): Promise<Article> {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/articles/${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return (await res.json()) as Article;
}

export async function saveArticle(
  apiBase: string,
  token: string,
  article: Article,
  isEdit: boolean,
): Promise<{ ok: boolean; slug?: string }> {
  const url = isEdit
    ? `${apiBase.replace(/\/$/, "")}/api/articles/${encodeURIComponent(article.slug)}`
    : `${apiBase.replace(/\/$/, "")}/api/articles`;

  const method = isEdit ? "PUT" : "POST";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token && token.trim()) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify({
      slug: article.slug,
      title: article.title,
      description: article.description,
      body: article.body,
      published: article.published,
      tags: article.tags,
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

export async function deleteArticle(
  apiBase: string,
  token: string,
  slug: string,
): Promise<{ ok: boolean }> {
  const headers: Record<string, string> = {};
  if (token && token.trim()) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }
  const res = await fetch(
    `${apiBase.replace(/\/$/, "")}/api/articles/${encodeURIComponent(slug)}`,
    {
      method: "DELETE",
      headers,
    },
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
