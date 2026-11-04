// A tiny read-only Plex: one movie library with a Kometa-built Thanksgiving collection (spike 03 shapes).
import type { FetchLike } from '../../src/clients/http.js';

export const PLEX = 'http://plex.test:32400';
const item = (title: string, year: number, guids: string[]) => ({ ratingKey: title, title, year, type: 'movie', Guid: guids.map((id) => ({ id })) });
export const fakePlex: FetchLike = async (url, init) => {
  if (new Headers(init?.headers).get('X-Plex-Token') !== 'plex-token') return new Response('unauthorised', { status: 401 });
  const path = url.replace(PLEX, '');
  const mc = (o: object) => new Response(JSON.stringify({ MediaContainer: o }));
  if (path === '/identity') return mc({ version: '1.43.5' });
  if (path === '/library/sections') return mc({ Directory: [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'Music', type: 'artist' }, { key: '3', title: 'TV Shows', type: 'show' }] });
  if (path === '/library/sections/1/collections') return mc({ Metadata: [{ ratingKey: '901', title: 'Thanksgiving Movies', titleSort: '!00_Thanksgiving Movies', childCount: '3', type: 'collection' }] });
  if (path === '/library/sections/3/collections') return mc({ Metadata: [] });
  if (path === '/library/collections/901/children?includeGuids=1') return mc({ Metadata: [
    item('Planes, Trains and Automobiles', 1987, ['imdb://tt0093748', 'tmdb://2609']),
    item('Addams Family Values', 1993, ['imdb://tt0106220', 'tmdb://2758']),
    item('Free Birds', 2013, ['imdb://tt1621039', 'tmdb://175574']),
  ] });
  return new Response('not found', { status: 404 });
};
