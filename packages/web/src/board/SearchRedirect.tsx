import { Navigate, useSearchParams } from 'react-router'

/**
 * Back-compat for the former standalone `/search` page: search is now an
 * on-demand modal over the board (`?search=1`). Any old link or bookmark to
 * `/search?q=…` lands here and is redirected to the board with the modal open,
 * carrying the query through so it opens pre-populated.
 */
export function SearchRedirect() {
  const [params] = useSearchParams()
  const next = new URLSearchParams()
  const q = params.get('q')
  if (q !== null && q !== '') next.set('q', q)
  next.set('search', '1')
  return <Navigate to={{ pathname: '/', search: `?${next.toString()}` }} replace />
}
