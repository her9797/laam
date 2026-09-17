package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/her9797/laam/laam-api/internal/config"
	"github.com/her9797/laam/laam-api/internal/lamdata"
	"github.com/her9797/laam/laam-api/internal/objectstore"
	"github.com/her9797/laam/laam-api/internal/store"
)

const (
	// maxExpenseJSONBytes bounds every expense/inventory JSON body. A full
	// 100-line receipt stays far below it.
	maxExpenseJSONBytes = 1 << 20

	maxReceiptImageBytes        = 5 << 20
	maxReceiptImageRequestBytes = 6 << 20

	receiptImageURLTTL        = 5 * time.Minute
	receiptImageDeleteTimeout = 10 * time.Second

	defaultInventoryAdjustmentLimit = 50
)

var receiptImageExtensions = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/webp": "webp",
}

type expenseCategoryRequest struct {
	Name string `json:"name"`
}

type createInventoryItemRequest struct {
	Name        string `json:"name"`
	CategoryID  string `json:"categoryId"`
	Unit        string `json:"unit"`
	Quantity    int    `json:"quantity"`
	MinQuantity int    `json:"minQuantity"`
}

type updateInventoryItemRequest struct {
	Name        *string         `json:"name"`
	CategoryID  *string         `json:"categoryId"`
	Unit        *string         `json:"unit"`
	MinQuantity *int            `json:"minQuantity"`
	IsArchived  *bool           `json:"isArchived"`
	Quantity    json.RawMessage `json:"quantity"`
}

type adjustInventoryItemRequest struct {
	Delta *int `json:"delta"`
	Set   *int `json:"set"`
}

type expenseReceiptLineRequest struct {
	ItemID      string `json:"itemId"`
	Quantity    *int   `json:"quantity"`
	CategoryID  string `json:"categoryId"`
	Description string `json:"description"`
	Amount      *int64 `json:"amount"`
}

type expenseReceiptRequest struct {
	Date          string                      `json:"date"`
	Vendor        string                      `json:"vendor"`
	PaymentMethod string                      `json:"paymentMethod"`
	Memo          string                      `json:"memo"`
	Lines         []expenseReceiptLineRequest `json:"lines"`
}

func (payload expenseReceiptRequest) storeInput() (store.ExpenseReceiptInput, error) {
	input := store.ExpenseReceiptInput{
		Date:          payload.Date,
		Vendor:        payload.Vendor,
		PaymentMethod: payload.PaymentMethod,
		Memo:          payload.Memo,
	}
	for i, line := range payload.Lines {
		if line.Amount == nil {
			return store.ExpenseReceiptInput{}, fmt.Errorf("%w: lines[%d].amount is required", store.ErrInvalidInput, i)
		}
		input.Lines = append(input.Lines, store.ExpenseReceiptLineInput{
			ItemID:      line.ItemID,
			Quantity:    line.Quantity,
			CategoryID:  line.CategoryID,
			Description: line.Description,
			Amount:      *line.Amount,
		})
	}
	return input, nil
}

// decodeExpenseJSON decodes a size-bounded JSON body into dst and writes the
// 413/400 error itself, returning false when the handler must stop.
func decodeExpenseJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxExpenseJSONBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, http.StatusRequestEntityTooLarge, fmt.Errorf("request body exceeds %d bytes", maxExpenseJSONBytes))
			return false
		}
		writeError(w, http.StatusBadRequest, err)
		return false
	}
	return true
}

func registerExpenseRoutes(mux *http.ServeMux, repository *store.Repository, cfg config.Config) {
	storage := objectstore.New(cfg.SupabaseURL, cfg.SupabaseStorageKey, cfg.ExpenseReceiptBucket, nil)

	handle := func(pattern string, methods map[string]http.HandlerFunc) {
		mux.HandleFunc(pattern, withCORS(cfg.AllowedOrigin, func(w http.ResponseWriter, r *http.Request) {
			if !requireAdminAuth(w, r, cfg.AdminAPIToken) {
				return
			}
			handler, ok := methods[r.Method]
			if !ok {
				writeMethodNotAllowed(w)
				return
			}
			handler(w, r)
		}))
	}
	// requireStorage guards the receipt image endpoints, which all need a
	// configured bucket.
	requireStorage := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !storage.Configured() {
				writeError(w, http.StatusServiceUnavailable, objectstore.ErrNotConfigured)
				return
			}
			next(w, r)
		}
	}

	handle("/api/v1/admin/expense-categories", map[string]http.HandlerFunc{
		http.MethodGet: func(w http.ResponseWriter, r *http.Request) {
			categories, err := repository.ListExpenseCategories(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, categories)
		},
		http.MethodPost: func(w http.ResponseWriter, r *http.Request) {
			var payload expenseCategoryRequest
			if !decodeExpenseJSON(w, r, &payload) {
				return
			}
			category, err := repository.CreateExpenseCategory(r.Context(), payload.Name)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, category)
		},
	})

	handle("/api/v1/admin/expense-categories/{id}", map[string]http.HandlerFunc{
		http.MethodPatch: func(w http.ResponseWriter, r *http.Request) {
			var payload expenseCategoryRequest
			if !decodeExpenseJSON(w, r, &payload) {
				return
			}
			category, err := repository.UpdateExpenseCategory(r.Context(), r.PathValue("id"), payload.Name)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, category)
		},
	})

	handle("/api/v1/admin/inventory-items", map[string]http.HandlerFunc{
		http.MethodGet: func(w http.ResponseWriter, r *http.Request) {
			var includeArchived bool
			switch r.URL.Query().Get("includeArchived") {
			case "", "false":
			case "true":
				includeArchived = true
			default:
				writeError(w, http.StatusBadRequest, fmt.Errorf("%w: includeArchived must be true or false", store.ErrInvalidInput))
				return
			}
			items, err := repository.ListInventoryItems(r.Context(), includeArchived)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, items)
		},
		http.MethodPost: func(w http.ResponseWriter, r *http.Request) {
			var payload createInventoryItemRequest
			if !decodeExpenseJSON(w, r, &payload) {
				return
			}
			item, err := repository.CreateInventoryItem(r.Context(), store.CreateInventoryItemInput(payload))
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, item)
		},
	})

	handle("/api/v1/admin/inventory-items/{id}", map[string]http.HandlerFunc{
		http.MethodPatch: func(w http.ResponseWriter, r *http.Request) {
			var payload updateInventoryItemRequest
			if !decodeExpenseJSON(w, r, &payload) {
				return
			}
			if len(payload.Quantity) > 0 {
				writeError(w, http.StatusBadRequest, fmt.Errorf("%w: quantity can only change through adjust", store.ErrInvalidInput))
				return
			}
			item, err := repository.UpdateInventoryItem(r.Context(), r.PathValue("id"), store.UpdateInventoryItemInput{
				Name:        payload.Name,
				CategoryID:  payload.CategoryID,
				Unit:        payload.Unit,
				MinQuantity: payload.MinQuantity,
				IsArchived:  payload.IsArchived,
			})
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, item)
		},
	})

	handle("/api/v1/admin/inventory-items/{id}/adjust", map[string]http.HandlerFunc{
		http.MethodPost: func(w http.ResponseWriter, r *http.Request) {
			var payload adjustInventoryItemRequest
			if !decodeExpenseJSON(w, r, &payload) {
				return
			}
			item, err := repository.AdjustInventoryItem(r.Context(), r.PathValue("id"), store.AdjustInventoryItemInput(payload))
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, item)
		},
	})

	handle("/api/v1/admin/inventory-items/{id}/adjustments", map[string]http.HandlerFunc{
		http.MethodGet: func(w http.ResponseWriter, r *http.Request) {
			limit := defaultInventoryAdjustmentLimit
			if raw := r.URL.Query().Get("limit"); raw != "" {
				parsed, err := strconv.Atoi(raw)
				if err != nil || parsed < 1 {
					writeError(w, http.StatusBadRequest, fmt.Errorf("%w: limit must be a positive integer", store.ErrInvalidInput))
					return
				}
				limit = parsed
			}
			adjustments, err := repository.ListInventoryAdjustments(r.Context(), r.PathValue("id"), limit)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, adjustments)
		},
	})

	handle("/api/v1/admin/inventory/summary", map[string]http.HandlerFunc{
		http.MethodGet: func(w http.ResponseWriter, r *http.Request) {
			summary, err := repository.GetInventorySummary(r.Context())
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, summary)
		},
	})

	handle("/api/v1/admin/expense-receipts", map[string]http.HandlerFunc{
		http.MethodGet: func(w http.ResponseWriter, r *http.Request) {
			query := r.URL.Query()
			receipts, err := repository.ListExpenseReceipts(r.Context(), query.Get("month"), query.Get("categoryId"))
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, receipts)
		},
		http.MethodPost: func(w http.ResponseWriter, r *http.Request) {
			var payload expenseReceiptRequest
			if !decodeExpenseJSON(w, r, &payload) {
				return
			}
			input, err := payload.storeInput()
			if err != nil {
				writeStoreError(w, err)
				return
			}
			receipt, err := repository.CreateExpenseReceipt(r.Context(), input)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusCreated, receipt)
		},
	})

	handle("/api/v1/admin/expense-receipts/{id}", map[string]http.HandlerFunc{
		http.MethodGet: func(w http.ResponseWriter, r *http.Request) {
			receipt, err := repository.GetExpenseReceipt(r.Context(), r.PathValue("id"))
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, receipt)
		},
		http.MethodPatch: func(w http.ResponseWriter, r *http.Request) {
			var payload expenseReceiptRequest
			if !decodeExpenseJSON(w, r, &payload) {
				return
			}
			input, err := payload.storeInput()
			if err != nil {
				writeStoreError(w, err)
				return
			}
			receipt, err := repository.UpdateExpenseReceipt(r.Context(), r.PathValue("id"), input)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, receipt)
		},
		http.MethodDelete: func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			imagePath, err := repository.DeleteExpenseReceipt(r.Context(), id)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			// The receipt is already gone; a leftover photo is only logged.
			if imagePath != "" {
				deleteReceiptImageBestEffort(storage, id, imagePath)
			}
			w.WriteHeader(http.StatusNoContent)
		},
	})

	handle("/api/v1/admin/expense-receipts/{id}/image", map[string]http.HandlerFunc{
		http.MethodPost: requireStorage(func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			if _, err := repository.GetExpenseReceiptImagePath(r.Context(), id); err != nil {
				writeStoreError(w, err)
				return
			}
			upload, status, err := readImageUpload(w, r, maxReceiptImageBytes, maxReceiptImageRequestBytes)
			if err != nil {
				writeError(w, status, err)
				return
			}

			objectPath, err := newReceiptImagePath(id, receiptImageExtensions[upload.mimeType])
			if err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			if err := storage.Upload(r.Context(), objectPath, upload.mimeType, upload.content); err != nil {
				writeError(w, http.StatusBadGateway, err)
				return
			}
			oldPath, err := repository.SetExpenseReceiptImagePath(r.Context(), id, objectPath)
			if err != nil {
				deleteReceiptImageBestEffort(storage, id, objectPath)
				writeStoreError(w, err)
				return
			}
			if oldPath != "" && oldPath != objectPath {
				deleteReceiptImageBestEffort(storage, id, oldPath)
			}

			receipt, err := repository.GetExpenseReceipt(r.Context(), id)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, receipt)
		}),
		http.MethodDelete: requireStorage(func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			imagePath, err := repository.GetExpenseReceiptImagePath(r.Context(), id)
			if err != nil {
				writeStoreError(w, err)
				return
			}
			if imagePath != "" {
				if err := storage.Delete(r.Context(), imagePath); err != nil && !errors.Is(err, objectstore.ErrNotFound) {
					writeError(w, http.StatusBadGateway, err)
					return
				}
				if err := repository.ClearExpenseReceiptImagePath(r.Context(), id, imagePath); err != nil {
					writeStoreError(w, err)
					return
				}
			}
			w.WriteHeader(http.StatusNoContent)
		}),
	})

	handle("/api/v1/admin/expense-receipts/{id}/image-url", map[string]http.HandlerFunc{
		http.MethodGet: requireStorage(func(w http.ResponseWriter, r *http.Request) {
			imagePath, err := repository.GetExpenseReceiptImagePath(r.Context(), r.PathValue("id"))
			if err != nil {
				writeStoreError(w, err)
				return
			}
			if imagePath == "" {
				writeError(w, http.StatusNotFound, errors.New("receipt has no image"))
				return
			}
			// Taken before signing so the reported expiry never outlives the URL.
			expiresAt := time.Now().Add(receiptImageURLTTL).UTC()
			signedURL, err := storage.SignedURL(r.Context(), imagePath, receiptImageURLTTL)
			if errors.Is(err, objectstore.ErrNotFound) {
				writeError(w, http.StatusNotFound, errors.New("receipt image not found in storage"))
				return
			}
			if err != nil {
				writeError(w, http.StatusBadGateway, err)
				return
			}
			writeJSON(w, http.StatusOK, lamdata.ExpenseReceiptImageURL{URL: signedURL, ExpiresAt: expiresAt.Format(time.RFC3339)})
		}),
	})

	handle("/api/v1/admin/expenses/summary", map[string]http.HandlerFunc{
		http.MethodGet: func(w http.ResponseWriter, r *http.Request) {
			summary, err := repository.GetExpenseSummary(r.Context(), r.URL.Query().Get("month"))
			if err != nil {
				writeStoreError(w, err)
				return
			}
			writeJSON(w, http.StatusOK, summary)
		},
	})
}

// newReceiptImagePath builds receipts/{receiptId}/{random}.{ext}. The
// client's original filename is never part of the object key.
func newReceiptImagePath(receiptID string, extension string) (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return "receipts/" + receiptID + "/" + hex.EncodeToString(random) + "." + extension, nil
}

func deleteReceiptImageBestEffort(storage *objectstore.Client, receiptID string, objectPath string) {
	ctx, cancel := context.WithTimeout(context.Background(), receiptImageDeleteTimeout)
	defer cancel()
	if err := storage.Delete(ctx, objectPath); err != nil && !errors.Is(err, objectstore.ErrNotFound) {
		log.Printf("expense: failed to delete image of receipt %s: %v", receiptID, err)
	}
}
