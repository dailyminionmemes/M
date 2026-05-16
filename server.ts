import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

const primaryAi = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY as string,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const backupKey = process.env.BACKUP_GEMINI_API_KEY;

// Only initialize OpenAI if a valid-looking key is provided (usually starting with sk-)
const backupAi = (backupKey && (backupKey.startsWith('sk-') || backupKey.length > 20)) 
  ? new OpenAI({
      apiKey: backupKey,
    })
  : null;

type AIClient = { type: 'gemini', client: GoogleGenAI } | { type: 'openai', client: OpenAI };

// Helper to retry AI calls and handle transient errors, including fallback to OpenAI
async function withRetry<T>(fn: (client: AIClient) => Promise<T>, retries = 4): Promise<T> {
  let useBackup = false;

  const execute = async (remainingRetries: number, currentType: 'gemini' | 'openai'): Promise<T> => {
    const ai: AIClient | null = currentType === 'gemini' 
      ? { type: 'gemini', client: primaryAi } 
      : (backupAi ? { type: 'openai', client: backupAi } : null);

    if (!ai) {
      if (currentType === 'openai') {
        throw new Error('Fallback to OpenAI failed: No valid backup API key configured.');
      }
      throw new Error('AI client not initialized.');
    }

    try {
      return await fn(ai);
    } catch (error: any) {
      const isRateLimit = error.status === 429 || (error.message && error.message.includes('429'));
      const isAuthError = error.status === 401 || (error.message && error.message.includes('401'));
      const isServiceUnavailable = error.status === 503;
      const isBusy = error.message?.includes('model is overloaded') || error.message?.includes('deadline exceeded');

      // If Gemini hit rate limit and we have a CONFIGURABLE backup, switch
      if (isRateLimit && currentType === 'gemini' && !useBackup && backupAi) {
        console.log('Primary Gemini hit rate limit. Switching to Backup OpenAI...');
        useBackup = true;
        return execute(remainingRetries, 'openai');
      }

      if (isAuthError && currentType === 'openai') {
        console.error('CRITICAL: OpenAI Backup key is invalid (401). Please check BACKUP_GEMINI_API_KEY.');
        throw new Error('AI Authentication Failed: The provided backup API key is invalid.');
      }

      if (remainingRetries > 0 && (isRateLimit || isServiceUnavailable || isBusy)) {
        let delay = 2000;
        if (currentType === 'gemini') {
          try {
            if (error.details) {
              const retryInfo = error.details.find((d: any) => d['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
              if (retryInfo?.retryDelay) {
                const seconds = parseInt(retryInfo.retryDelay);
                if (!isNaN(seconds)) delay = seconds * 1000 + 500;
              }
            }
          } catch (e) {
            console.error('Failed to parse Gemini retry delay', e);
          }
        }

        const actualDelay = Math.min(delay, 10000);
        console.log(`AI error ${error.status} on ${currentType.toUpperCase()}, retrying in ${actualDelay}ms... (${remainingRetries} left)`);
        await new Promise(resolve => setTimeout(resolve, actualDelay));
        return execute(remainingRetries - 1, currentType);
      }
      throw error;
    }
  };

  return execute(retries, 'gemini');
}

// Helper to robustly parse JSON from AI response
function parseAIResponse(text: string) {
  try {
    const cleaned = text.trim();
    // Try to find JSON block if AI wrapped it in markdown
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse AI response:', text);
    throw new Error('Invalid AI response format');
  }
}

// Movie/Series Enrichment Endpoint
app.post('/api/content/enrich', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const data = await withRetry(async (ai) => {
      if (ai.type === 'gemini') {
        const response = await ai.client.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `You are the ultimate CineLog AI engine. Perform a deep research on "${name}". 
          Be extremely precise. We need the REAL production details. 
          - Genres: Array of strings.
          - Summary: A captivating 2-3 sentence description.
          - AI Tags: Mood/vibe descriptors.
          - Thumbnail: Find a DIRECT, high-resolution poster or movie-still URL.
          - Release Year: Exact number.
          - Company: Official studio/network.
          
          Output ONLY the JSON object. Do not include markdown code blocks.`,
          config: {
            tools: [{ googleSearch: {} }] as any,
            responseMimeType: 'application/json',
            maxOutputTokens: 2048,
            temperature: 0.1,
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                type: { type: Type.STRING, enum: ['film', 'series'] },
                company: { type: Type.STRING },
                genres: { type: Type.ARRAY, items: { type: Type.STRING } },
                release_year: { type: Type.NUMBER },
                summary: { type: Type.STRING },
                thumbnail_url: { type: Type.STRING },
                ai_tags: { type: Type.ARRAY, items: { type: Type.STRING } },
                age_rating: { type: Type.STRING },
              },
              required: ['name', 'type', 'genres', 'release_year'],
            },
          },
        });
        return parseAIResponse(response.text);
      } else {
        // OpenAI Fallback
        const response = await ai.client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an elite film metadata engine. Return JSON only.' },
            { role: 'user', content: `Provide metadata for "${name}". Include: name, type (film/series), company, genres (array), release_year (int), summary, thumbnail_url, ai_tags (array), age_rating.` }
          ],
          response_format: { type: 'json_object' }
        });
        return JSON.parse(response.choices[0].message.content || '{}');
      }
    });

    if (!data.thumbnail_url || data.thumbnail_url.includes('placeholder')) {
       data.thumbnail_url = `https://images.unsplash.com/photo-1485846234645-a62644f84728?q=80&w=400&h=600&auto=format&fit=crop`;
    }
    
    res.json(data);
  } catch (error: any) {
    console.error('Enrichment error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to enrich content' });
  }
});

// Recommendation Endpoint
app.post('/api/content/recommend', async (req, res) => {
  try {
    const { history } = req.body; 
    const data = await withRetry(async (ai) => {
      if (ai.type === 'gemini') {
        const response = await ai.client.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `Use Google Search to find 4 highly-rated movies or series released in the last 2 years that are trending right now and strongly align with this watch history: ${JSON.stringify(history)}. 
          For each, specify why it's a perfect match, its current match percentage, release year, and a high-quality poster URL. Output as a JSON array.`,
          config: {
            tools: [{ googleSearch: {} }] as any,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  type: { type: Type.STRING },
                  year: { type: Type.NUMBER },
                  matchPercentage: { type: Type.NUMBER },
                  reason: { type: Type.STRING },
                  thumbnail_url: { type: Type.STRING },
                },
                required: ['name', 'type', 'year', 'matchPercentage', 'reason'],
              },
            },
          },
        });
        return parseAIResponse(response.text);
      } else {
        // OpenAI Fallback
        const response = await ai.client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are a professional film recommender. Return JSON array under "recommendations" key.' },
            { role: 'user', content: `Suggest 4 movies/series based on this history: ${JSON.stringify(history)}. Include name, type, year, matchPercentage, reason, thumbnail_url.` }
          ],
          response_format: { type: 'json_object' }
        });
        const result = JSON.parse(response.choices[0].message.content || '{}');
        return result.recommendations || result;
      }
    });

    const processedData = (Array.isArray(data) ? data : []).map((rec: any) => {
      if (!rec.thumbnail_url || rec.thumbnail_url.includes('placeholder') || !rec.thumbnail_url.startsWith('http')) {
        rec.thumbnail_url = `https://images.unsplash.com/photo-1485090916751-242966556e2d?q=80&w=400&h=600&auto=format&fit=crop`;
      }
      return rec;
    });

    res.json(processedData);
  } catch (error: any) {
    console.error('Recommendation error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to generate recommendations' });
  }
});

// NLP Search Endpoint
app.post('/api/search', async (req, res) => {
  try {
    const { query, history } = req.body;
    const data = await withRetry(async (ai) => {
      if (ai.type === 'gemini') {
        const response = await ai.client.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: `The user query is: "${query}".
          User's watch history: ${JSON.stringify(history)}.
          
          1. If the user is asking to find or filter items from their history, return the exact names/IDs in 'matchingIds'.
          2. If the user is asking general questions about films, actors, or current trends not fully covered in their history, use Google Search to provide a detailed and insightful 'explanation'.
          3. If the query matches history items AND contains general questions, do both.`,
          config: {
            tools: [{ googleSearch: {} }] as any,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                matchingIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Names of items from history that match the filter' },
                explanation: { type: Type.STRING, description: 'AI response to general questions or interesting insights' },
              },
            },
          },
        });
        return parseAIResponse(response.text);
      } else {
        // OpenAI Fallback
        const response = await ai.client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'You are an AI cinema assistant. Return JSON only.' },
            { role: 'user', content: `Process this search query: "${query}" given history: ${JSON.stringify(history)}. Output: matchingIds (names from history array), explanation (string for general vibes/info).` }
          ],
          response_format: { type: 'json_object' }
        });
        return JSON.parse(response.choices[0].message.content || '{}');
      }
    });
    res.json(data);
  } catch (error: any) {
    console.error('Search error:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to process search' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

