import { logger } from './logger';
/**
 * Giphy API client
 *
 * Provides type-safe search and trending GIF fetching with request
 * cancellation, timeouts, and input validation.
 *
 * Usage with cancellation (prevents stale results during rapid typing):
 * ```ts
 * const controller = new AbortController();
 * const gifs = await searchGifs(query, 20, controller.signal);
 * // Later: controller.abort();
 * ```
 */

/**
 * Giphy public beta key — suitable for development only.
 * Replace with a production key from https://developers.giphy.com
 * before shipping.
 */
const GIPHY_API_KEY = 'dc6zaTOxFJmzC';

const BASE_URL           = 'https://api.giphy.com/v1/gifs';
const DEFAULT_LIMIT      = 20;
const MAX_LIMIT          = 50;
const CONTENT_RATING     = 'pg-13';
const REQUEST_TIMEOUT_MS = 10_000;

export interface GiphyGif {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface GifCategory {
  readonly label: string;
  readonly query: string;
}

interface GiphyImageVariant {
  readonly url: string;
  readonly width: string;
  readonly height: string;
}

interface GiphyApiGif {
  readonly id: string;
  readonly title: string;
  readonly images: {
    readonly fixed_height: GiphyImageVariant;
    readonly fixed_height_small?: GiphyImageVariant;
    readonly preview_gif?: GiphyImageVariant;
  };
}

interface GiphyApiResponse {
  readonly data?: readonly GiphyApiGif[];
}

function clampLimit(limit: number): string {
  return String(Math.max(1, Math.min(Math.round(limit), MAX_LIMIT)));
}

function mapGif(gif: GiphyApiGif): GiphyGif {
  const { fixed_height, fixed_height_small, preview_gif } = gif.images;
  return {
    id:         gif.id,
    title:      gif.title,
    url:        fixed_height.url,
    previewUrl: fixed_height_small?.url ?? preview_gif?.url ?? fixed_height.url,
    width:      parseInt(fixed_height.width,  10) || 0,
    height:     parseInt(fixed_height.height, 10) || 0,
  };
}

async function fetchGiphy(
  endpoint: string,
  params: Record<string, string>,
  externalSignal?: AbortSignal,
): Promise<GiphyGif[]> {
  const searchParams = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    rating:  CONTENT_RATING,
    ...params,
  });

  let controller: AbortController | undefined;
  let timeoutId:  ReturnType<typeof setTimeout> | undefined;

  const signal = (() => {
    if (externalSignal) return externalSignal;
    controller = new AbortController();
    timeoutId  = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
    return controller.signal;
  })();

  try {
    const response = await fetch(`${BASE_URL}/${endpoint}?${searchParams}`, { signal });
    if (!response.ok) throw new Error(`Giphy API responded with HTTP ${response.status}`);
    const json: GiphyApiResponse = await response.json();
    return (json.data ?? []).map(mapGif);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') return [];
    logger.warn(`Giphy ${endpoint} request failed:`, error);
    return [];
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function searchGifs(
  query: string,
  limit: number = DEFAULT_LIMIT,
  signal?: AbortSignal,
): Promise<GiphyGif[]> {
  const trimmed = query.trim();
  if (!trimmed) return getTrendingGifs(limit, signal);
  return fetchGiphy('search', { q: trimmed, limit: clampLimit(limit) }, signal);
}

export async function getTrendingGifs(
  limit: number = DEFAULT_LIMIT,
  signal?: AbortSignal,
): Promise<GiphyGif[]> {
  return fetchGiphy('trending', { limit: clampLimit(limit) }, signal);
}

export const GIF_CATEGORIES: readonly GifCategory[] = [
  { label: '😂 Funny',    query: 'funny'          },
  { label: '❤️ Love',     query: 'love'            },
  { label: '👋 Hello',    query: 'hello wave'      },
  { label: '🎉 Excited',  query: 'excited happy'   },
  { label: '😢 Sad',      query: 'sad cry'         },
  { label: '🤔 Thinking', query: 'thinking hmm'    },
  { label: '👍 Yes',      query: 'thumbs up yes'   },
  { label: '👎 No',       query: 'no nope'         },
  { label: '🙏 Thanks',   query: 'thank you thanks'},
  { label: '😍 Wow',      query: 'wow amazing'     },
] as const;
