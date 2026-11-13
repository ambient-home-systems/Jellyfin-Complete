// A tiny read-only Plex: a Kometa-built Thanksgiving collection, and Kometa's "IMDb Top 250" once in the films library
// and once in the TV library, as Kometa names it per library (spike 03 shapes).
import type { FetchLike } from '../../src/clients/http.js';

export const PLEX = 'http://plex.test:32400';
const item = (title: string, year: number, guids: string[]) => ({ ratingKey: title, title, year, type: 'movie', Guid: guids.map((id) => ({ id })) });
export const fakePlex: FetchLike = async (url, init) => {
  if (new Headers(init?.headers).get('X-Plex-Token') !== 'plex-token') return new Response('unauthorised', { status: 401 });
  const path = url.replace(PLEX, '');
  const mc = (o: object) => new Response(JSON.stringify({ MediaContainer: o }));
  if (path === '/identity') return mc({ version: '1.43.5' });
  if (path === '/library/sections') return mc({ Directory: [{ key: '1', title: 'Movies', type: 'movie' }, { key: '2', title: 'Music', type: 'artist' }, { key: '3', title: 'TV Shows', type: 'show' }] });
  if (path === '/library/sections/1/collections') return mc({ Metadata: [{ ratingKey: '901', title: 'Thanksgiving Movies', titleSort: '!00_Thanksgiving Movies', childCount: '3', type: 'collection' }, { ratingKey: '902', title: 'IMDb Top 250', titleSort: '!020_IMDb Top 250', childCount: '1', type: 'collection' }] });
  if (path === '/library/sections/3/collections') return mc({ Metadata: [{ ratingKey: '903', title: 'IMDb Top 250', titleSort: '!020_IMDb Top 250', childCount: '1', type: 'collection' }] });
  if (path === '/library/collections/902/children?includeGuids=1') return mc({ Metadata: [item('The Shawshank Redemption', 1994, ['imdb://tt0111161', 'tmdb://278'])] });
  if (path === '/library/collections/903/children?includeGuids=1') return mc({ Metadata: [{ ...item('Breaking Bad', 2008, ['imdb://tt0903747', 'tvdb://81189']), type: 'show' }] });
  if (path === '/library/collections/901/children?includeGuids=1') return mc({ Metadata: [
    item('Planes, Trains and Automobiles', 1987, ['imdb://tt0093748', 'tmdb://2609']),
    item('Addams Family Values', 1993, ['imdb://tt0106220', 'tmdb://2758']),
    item('Free Birds', 2013, ['imdb://tt1621039', 'tmdb://175574']),
  ] });
  return new Response('not found', { status: 404 });
};
