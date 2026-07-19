import { type CreateFilterPresetInput, type UpdateFilterPresetInput } from '@rivian-kanban/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { strings } from '../strings.ts'
import { useApi } from './api-context.ts'
import { queryKeys } from './keys.ts'
import { notifyError, notifySuccess } from './notify.ts'
import { filterPresetResponseSchema, filterPresetsResponseSchema } from './schemas.ts'

/** The caller's saved board-filter presets (per-user, newest-first). */
export function useFilterPresets() {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.filterPresets,
    queryFn: () => api.get('/filter-presets', filterPresetsResponseSchema),
  })
}

/** `POST /filter-presets` — save the current filter under a name. */
export function useCreateFilterPreset() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateFilterPresetInput) =>
      api.post('/filter-presets', filterPresetResponseSchema, { body: input }),
    onSuccess: () => {
      notifySuccess(strings.filterBar.presetSaved)
      void queryClient.invalidateQueries({ queryKey: queryKeys.filterPresets })
    },
    onError: notifyError,
  })
}

/** `PATCH /filter-presets/:id` — rename, replace the saved filter, and/or (un)share. */
export function useUpdateFilterPreset() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateFilterPresetInput }) =>
      api.patch(`/filter-presets/${id}`, filterPresetResponseSchema, { body: patch }),
    onSuccess: () => {
      notifySuccess(strings.filterBar.presetUpdated)
      void queryClient.invalidateQueries({ queryKey: queryKeys.filterPresets })
    },
    onError: notifyError,
  })
}

/** `DELETE /filter-presets/:id`. */
export function useDeleteFilterPreset() {
  const api = useApi()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteVoid(`/filter-presets/${id}`),
    onSuccess: () => {
      notifySuccess(strings.filterBar.presetDeleted)
      void queryClient.invalidateQueries({ queryKey: queryKeys.filterPresets })
    },
    onError: notifyError,
  })
}
