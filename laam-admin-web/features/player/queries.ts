import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { requestsKeys } from "@/features/requests/queries";

import { fetchSongQueue, updateSongQueueStatus } from "./api";
import { songQueueKeys } from "./keys";
import type { SongQueueUpdateStatus } from "./model";

export { songQueueKeys } from "./keys";

export function useSongQueueQuery() {
  return useQuery({
    queryKey: songQueueKeys.all,
    queryFn: fetchSongQueue,
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  });
}

export function useUpdateSongQueueStatusMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ queueId, status }: { queueId: string; status: SongQueueUpdateStatus }) =>
      updateSongQueueStatus(queueId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: requestsKeys.all });
      queryClient.invalidateQueries({ queryKey: songQueueKeys.all });
    },
  });
}
