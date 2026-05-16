import { ContentEntry, Recommendation } from '../types';

export const aiService = {
  enrich: async (name: string): Promise<Partial<ContentEntry>> => {
    const res = await fetch('/api/content/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('Enrichment failed');
    return res.json();
  },

  getRecommendations: async (history: ContentEntry[]): Promise<Recommendation[]> => {
    const res = await fetch('/api/content/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history: history.slice(0, 10) }), // Only send last 10 for context
    });
    if (!res.ok) throw new Error('Recommendation failed');
    return res.json();
  },

  searchNLP: async (query: string, history: ContentEntry[]): Promise<{ matchingIds: string[], explanation: string }> => {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, history }),
    });
    if (!res.ok) throw new Error('Search failed');
    return res.json();
  }
};
