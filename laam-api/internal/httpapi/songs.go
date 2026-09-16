package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/youtube"
)

type updateSongQueueStatusRequest struct {
	Status string `json:"status"`
}

func registerSongRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config) {
	youtubeClient := youtube.NewClient(cfg.YouTubeAPIBaseURL, cfg.YouTubeAPIKey, nil)

	mux.HandleFunc("/api/v1/admin/song-requests/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if r.Method != http.MethodPost {
			writeMethodNotAllowed(w)
			return
		}

		requestID, ok := parseActionResourceID(r.URL.Path, "/api/v1/admin/song-requests/", "approve")
		if !ok {
			http.NotFound(w, r)
			return
		}

		query, err := repository.GetSongRequestQuery(r.Context(), requestID)
		if err != nil {
			writeStoreError(w, err)
			return
		}
		video, err := youtubeClient.Search(r.Context(), query)
		if err != nil {
			writeYouTubeError(w, err)
			return
		}
		item, err := repository.QueueSongRequest(r.Context(), requestID, store.QueueSongRequestInput{
			YouTubeVideoID:      video.ID,
			YouTubeTitle:        video.Title,
			YouTubeChannelTitle: video.ChannelTitle,
		})
		if err != nil {
			writeStoreError(w, err)
			return
		}

		writeJSON(w, http.StatusCreated, item)
	}))

	mux.HandleFunc("/api/v1/admin/song-player/queue", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if r.Method != http.MethodGet {
			writeMethodNotAllowed(w)
			return
		}

		items, err := repository.ListActiveSongQueue(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, items)
	}))

	mux.HandleFunc("/api/v1/admin/song-player/queue/", withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
		if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
			return
		}
		if r.Method != http.MethodPatch {
			writeMethodNotAllowed(w)
			return
		}

		queueID, ok := parseStatusResourceID(r.URL.Path, "/api/v1/admin/song-player/queue/")
		if !ok {
			http.NotFound(w, r)
			return
		}
		var payload updateSongQueueStatusRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		if err := repository.UpdateSongQueueStatus(r.Context(), queueID, strings.TrimSpace(payload.Status)); err != nil {
			writeStoreError(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
}

func parseActionResourceID(path string, prefix string, action string) (string, bool) {
	rest, ok := strings.CutPrefix(path, prefix)
	if !ok {
		return "", false
	}
	suffix := "/" + action
	if !strings.HasSuffix(rest, suffix) {
		return "", false
	}
	id := strings.TrimSuffix(rest, suffix)
	if strings.TrimSpace(id) == "" || strings.Contains(id, "/") {
		return "", false
	}
	return id, true
}

func writeYouTubeError(w http.ResponseWriter, err error) {
	var apiErr *youtube.APIError
	switch {
	case errors.Is(err, youtube.ErrNotConfigured):
		writeError(w, http.StatusServiceUnavailable, err)
	case errors.Is(err, youtube.ErrNoResults):
		writeError(w, http.StatusNotFound, err)
	case errors.As(err, &apiErr):
		writeError(w, http.StatusBadGateway, err)
	default:
		writeError(w, http.StatusBadGateway, err)
	}
}
