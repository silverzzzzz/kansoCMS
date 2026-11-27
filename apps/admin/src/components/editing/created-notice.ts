import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/** Carry the save confirmation across the single transition from /new to the new record. */
export function markCreated(client: QueryClient, kind: string, id: number) {
  client.setQueryData(['editor-created', kind, id], true)
}

export function useCreatedNotice(kind: string, id: number) {
  const client = useQueryClient()
  const [saved] = useState(() => client.getQueryData(['editor-created', kind, id]) === true)
  useEffect(() => {
    client.removeQueries({ queryKey: ['editor-created', kind, id], exact: true })
  }, [client, kind, id])
  return saved
}
