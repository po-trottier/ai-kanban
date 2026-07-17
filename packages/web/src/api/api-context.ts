import { createContext, useContext } from 'react'
import { ApiClient } from './client.ts'

/**
 * The ApiClient rides through context so tests inject a client built on a
 * hand-written fake fetch instead of the network (docs/dev/testing.md).
 */
export const ApiContext = createContext<ApiClient>(new ApiClient())

export function useApi(): ApiClient {
  return useContext(ApiContext)
}
