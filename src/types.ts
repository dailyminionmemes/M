/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ContentType = 'film' | 'series';

export interface ContentEntry {
  id: string;
  name: string;
  thumbnail_url: string;
  type: ContentType;
  rating: number;
  company: string;
  watched_on: string;
  date_watched: string;
  genres: string[];
  ai_tags: string[];
  summary?: string;
  release_year?: number;
  age_rating?: string;
}

export interface Recommendation {
  name: string;
  type: string;
  year: number;
  matchPercentage: number;
  reason: string;
  thumbnail_url: string;
}

export interface UserStats {
  totalWatched: number;
  avgRating: number;
  topGenres: string[];
  platforms: Record<string, number>;
  mostWatchedPlatform: string;
  tasteProfile: string;
}
