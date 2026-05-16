export interface ContentEnrichment {
  name: string;
  type: 'film' | 'series';
  company: string;
  genres: string[];
  release_year: number;
  summary: string;
  thumbnail_url: string;
  ai_tags: string[];
}

export interface Recommendation {
  name: string;
  type: string;
  year: number;
  matchPercentage: number;
  reason: string;
  thumbnail_url: string;
}

export interface SearchResult {
  matchingIds: string[];
  explanation: string;
}

export const enrichContent = async (name: string): Promise<ContentEnrichment> => {
  const res = await fetch('/api/content/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Enrichment failed');
  }
  return res.json();
};

export const getRecommendations = async (history: any[]): Promise<Recommendation[]> => {
  const res = await fetch('/api/content/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Recommendations failed');
  }
  return res.json();
};

export const nlpSearch = async (query: string, history: any[]): Promise<SearchResult> => {
  const res = await fetch('/api/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, history }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Search failed');
  }
  return res.json();
};
