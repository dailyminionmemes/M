import { ContentEntry, UserStats } from '../types';

const STORAGE_KEY = 'cinelog_history';

export const storage = {
  getHistory: (): ContentEntry[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  saveEntry: (entry: ContentEntry) => {
    const history = storage.getHistory();
    const updated = [entry, ...history];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  },

  deleteEntry: (id: string) => {
    const history = storage.getHistory();
    const updated = history.filter(e => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  },

  getStats: (history: ContentEntry[]): UserStats => {
    if (history.length === 0) {
      return {
        totalWatched: 0,
        avgRating: 0,
        topGenres: [],
        platforms: {},
        mostWatchedPlatform: 'None',
        tasteProfile: 'Standard',
      };
    }

    const totalWatched = history.length;
    const avgRating = history.reduce((acc, curr) => acc + curr.rating, 0) / totalWatched;
    
    const genreCounts: Record<string, number> = {};
    const platformCounts: Record<string, number> = {};

    history.forEach(entry => {
      entry.genres.forEach(g => {
        genreCounts[g] = (genreCounts[g] || 0) + 1;
      });
      platformCounts[entry.watched_on] = (platformCounts[entry.watched_on] || 0) + 1;
    });

    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name]) => name);

    const mostWatchedPlatform = Object.entries(platformCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    return {
      totalWatched,
      avgRating: Number(avgRating.toFixed(1)),
      topGenres,
      platforms: platformCounts,
      mostWatchedPlatform,
      tasteProfile: history.length > 10 ? 'Cinephile Elite' : 'Casual Watcher',
    };
  }
};
