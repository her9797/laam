package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/her9797/lam/lam-api/internal/lamdata"
	"github.com/jackc/pgx/v5"
)

var paymentAmountPattern = regexp.MustCompile(`^(?:[1-9][0-9]*|[1-9][0-9]{0,2}(?:,[0-9]{3})+)원$`)

type PaymentOrder struct {
	OrderID           string                     `json:"orderId"`
	MenuItemID        string                     `json:"menuItemId"`
	TossCatalogItemID string                     `json:"-"`
	MenuItemName      string                     `json:"menuItemName"`
	CategoryName      string                     `json:"categoryName"`
	TableNumber       string                     `json:"tableNumber"`
	RequestNote       string                     `json:"requestNote"`
	Amount            int64                      `json:"amount"`
	Status            string                     `json:"status"`
	PaymentKey        string                     `json:"paymentKey,omitempty"`
	PaymentMethod     string                     `json:"paymentMethod,omitempty"`
	ApprovedAt        string                     `json:"approvedAt,omitempty"`
	VAT               int64                      `json:"vat"`
	SuppliedAmount    int64                      `json:"suppliedAmount"`
	TaxFreeAmount     int64                      `json:"taxFreeAmount"`
	POSSyncStatus     string                     `json:"posSyncStatus"`
	POSOrderID        string                     `json:"posOrderId,omitempty"`
	POSSyncError      string                     `json:"posSyncError,omitempty"`
	CreatedAt         string                     `json:"createdAt"`
	OptionChoices     []PaymentOrderOptionChoice `json:"optionChoices,omitempty"`
}

type OrderOptionChoiceInput struct {
	OptionID       string `json:"optionId"`
	OptionChoiceID string `json:"optionChoiceId"`
	Quantity       int64  `json:"quantity"`
}

type PaymentOrderOptionChoice struct {
	OptionID       string `json:"optionId"`
	OptionChoiceID string `json:"optionChoiceId"`
	OptionTitle    string `json:"optionTitle"`
	ChoiceTitle    string `json:"choiceTitle"`
	PriceValue     int64  `json:"priceValue"`
	Quantity       int64  `json:"quantity"`
}

type POSPluginOrder struct {
	OrderID       string                     `json:"orderId"`
	TableNumber   string                     `json:"tableNumber"`
	CatalogItemID string                     `json:"catalogItemId"`
	MenuItemName  string                     `json:"menuItemName"`
	CategoryName  string                     `json:"categoryName"`
	RequestNote   string                     `json:"requestNote"`
	Amount        int64                      `json:"amount"`
	BaseAmount    int64                      `json:"baseAmount"`
	OptionChoices []PaymentOrderOptionChoice `json:"optionChoices,omitempty"`
}

type POSPluginOrderClaim struct {
	ClaimToken string         `json:"claimToken"`
	Order      POSPluginOrder `json:"order"`
}

type availableOrderOption struct {
	ID         string
	Title      string
	Required   bool
	MinChoices int
	MaxChoices int
	Choices    map[string]availableOrderOptionChoice
}

type availableOrderOptionChoice struct {
	ID              string
	Title           string
	PriceValue      int64
	QuantityEnabled bool
	MinQuantity     int64
	MaxQuantity     int64
}

const paymentOrderRequestNoteMaxLength = 200

func normalizePaymentOrderRequestNote(note string) (string, error) {
	note = strings.TrimSpace(note)
	if len([]rune(note)) > paymentOrderRequestNoteMaxLength {
		return "", ErrInvalidInput
	}
	return note, nil
}

func parsePaymentAmount(price string) (int64, error) {
	normalized := strings.TrimSpace(price)
	if !paymentAmountPattern.MatchString(normalized) {
		return 0, ErrInvalidInput
	}

	amountText := strings.TrimSuffix(strings.ReplaceAll(normalized, ",", ""), "원")
	amount, err := strconv.ParseInt(amountText, 10, 64)
	if err != nil || amount <= 0 {
		return 0, ErrInvalidInput
	}

	return amount, nil
}

func (r *Repository) CreatePaymentOrder(ctx context.Context, menuItemID string, tableNumber string, requestNote string, optionChoices []OrderOptionChoiceInput) (PaymentOrder, error) {
	menuItemID = strings.TrimSpace(menuItemID)
	if menuItemID == "" {
		return PaymentOrder{}, ErrInvalidInput
	}
	requestNote, err := normalizePaymentOrderRequestNote(requestNote)
	if err != nil {
		return PaymentOrder{}, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return PaymentOrder{}, err
	}
	defer tx.Rollback(ctx)

	var itemName string
	var categoryName string
	var price string
	var tossCatalogItemID string
	err = tx.QueryRow(ctx, `
		SELECT mi.name, mc.label, mi.price, mi.toss_catalog_item_id
		FROM menu_items mi
		JOIN menu_categories mc ON mc.id = mi.category_id
		WHERE mi.id = $1
			AND mi.is_visible = TRUE
			AND mc.is_visible = TRUE
			AND mi.toss_catalog_item_id IS NOT NULL
	`, menuItemID).Scan(&itemName, &categoryName, &price, &tossCatalogItemID)
	if err != nil {
		return PaymentOrder{}, classifyError(err)
	}

	amount, err := parsePaymentAmount(price)
	if err != nil {
		return PaymentOrder{}, err
	}
	availableOptions, err := loadAvailableOrderOptions(ctx, tx, menuItemID)
	if err != nil {
		return PaymentOrder{}, err
	}
	selectedOptions, additionalAmount, err := resolvePaymentOrderOptions(availableOptions, optionChoices)
	if err != nil {
		return PaymentOrder{}, err
	}
	amount += additionalAmount
	if amount <= 0 {
		return PaymentOrder{}, ErrInvalidInput
	}

	orderID := nextID("order")
	_, err = tx.Exec(ctx, `
		INSERT INTO payment_orders (
			id, menu_item_id, toss_catalog_item_id, menu_item_name, category_name, table_number, request_note, amount
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, orderID, menuItemID, tossCatalogItemID, itemName, categoryName, strings.TrimSpace(tableNumber), requestNote, amount)
	if err != nil {
		return PaymentOrder{}, classifyError(err)
	}
	for _, choice := range selectedOptions {
		if _, err := tx.Exec(ctx, `
			INSERT INTO payment_order_option_choices (
				order_id, option_id, option_choice_id, option_title,
				option_choice_title, price_value, quantity
			) VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, orderID, choice.OptionID, choice.OptionChoiceID, choice.OptionTitle,
			choice.ChoiceTitle, choice.PriceValue, choice.Quantity); err != nil {
			return PaymentOrder{}, classifyError(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return PaymentOrder{}, err
	}

	return r.GetPaymentOrder(ctx, orderID)
}

func loadAvailableOrderOptions(ctx context.Context, tx pgx.Tx, menuItemID string) ([]availableOrderOption, error) {
	rows, err := tx.Query(ctx, `
		SELECT mo.id, mo.title, mo.is_required, mo.min_choices, mo.max_choices
		FROM menu_item_options mio
		JOIN menu_options mo ON mo.id = mio.option_id
		WHERE mio.menu_item_id = $1 AND mo.is_enabled = TRUE
		ORDER BY mio.sort_order, mo.id
	`, menuItemID)
	if err != nil {
		return nil, err
	}
	options := make([]availableOrderOption, 0)
	for rows.Next() {
		var option availableOrderOption
		option.Choices = make(map[string]availableOrderOptionChoice)
		if err := rows.Scan(&option.ID, &option.Title, &option.Required, &option.MinChoices, &option.MaxChoices); err != nil {
			rows.Close()
			return nil, err
		}
		options = append(options, option)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	byID := make(map[string]*availableOrderOption, len(options))
	for index := range options {
		byID[options[index].ID] = &options[index]
	}
	choiceRows, err := tx.Query(ctx, `
		SELECT moc.option_id, moc.id, moc.title, moc.price_value,
			moc.quantity_enabled, moc.min_quantity, moc.max_quantity
		FROM menu_item_options mio
		JOIN menu_option_choices moc ON moc.option_id = mio.option_id
		WHERE mio.menu_item_id = $1 AND moc.is_enabled = TRUE AND moc.state = 'ON_SALE'
	`, menuItemID)
	if err != nil {
		return nil, err
	}
	defer choiceRows.Close()
	for choiceRows.Next() {
		var optionID string
		var choice availableOrderOptionChoice
		if err := choiceRows.Scan(&optionID, &choice.ID, &choice.Title, &choice.PriceValue, &choice.QuantityEnabled, &choice.MinQuantity, &choice.MaxQuantity); err != nil {
			return nil, err
		}
		if option := byID[optionID]; option != nil {
			option.Choices[choice.ID] = choice
		}
	}
	return options, choiceRows.Err()
}

func resolvePaymentOrderOptions(options []availableOrderOption, inputs []OrderOptionChoiceInput) ([]PaymentOrderOptionChoice, int64, error) {
	byID := make(map[string]availableOrderOption, len(options))
	selectedCounts := make(map[string]int)
	seenChoices := make(map[string]struct{})
	for _, option := range options {
		byID[option.ID] = option
	}

	selected := make([]PaymentOrderOptionChoice, 0, len(inputs))
	var additionalAmount int64
	for _, input := range inputs {
		option, ok := byID[strings.TrimSpace(input.OptionID)]
		if !ok || input.Quantity <= 0 {
			return nil, 0, ErrInvalidInput
		}
		choiceID := strings.TrimSpace(input.OptionChoiceID)
		choice, ok := option.Choices[choiceID]
		if !ok {
			return nil, 0, ErrInvalidInput
		}
		selectionKey := option.ID + "\x00" + choiceID
		if _, duplicate := seenChoices[selectionKey]; duplicate {
			return nil, 0, ErrInvalidInput
		}
		seenChoices[selectionKey] = struct{}{}
		if !choice.QuantityEnabled && input.Quantity != 1 {
			return nil, 0, ErrInvalidInput
		}
		if choice.QuantityEnabled && (input.Quantity < choice.MinQuantity || input.Quantity > choice.MaxQuantity) {
			return nil, 0, ErrInvalidInput
		}
		selectedCounts[option.ID]++
		additionalAmount += choice.PriceValue * input.Quantity
		selected = append(selected, PaymentOrderOptionChoice{
			OptionID: option.ID, OptionChoiceID: choice.ID, OptionTitle: option.Title,
			ChoiceTitle: choice.Title, PriceValue: choice.PriceValue, Quantity: input.Quantity,
		})
	}

	for _, option := range options {
		count := selectedCounts[option.ID]
		if count == 0 && !option.Required {
			continue
		}
		minimum := option.MinChoices
		if option.Required && minimum < 1 {
			minimum = 1
		}
		if count < minimum || (option.MaxChoices > 0 && count > option.MaxChoices) {
			return nil, 0, ErrInvalidInput
		}
	}
	return selected, additionalAmount, nil
}

func (r *Repository) GetPaymentOrder(ctx context.Context, orderID string) (PaymentOrder, error) {
	var order PaymentOrder
	var approvedAt *time.Time
	var createdAt time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT
			id,
			COALESCE(menu_item_id, ''),
			COALESCE(toss_catalog_item_id, ''),
			menu_item_name,
			category_name,
			table_number,
			request_note,
			amount,
			status,
			COALESCE(payment_key, ''),
			COALESCE(payment_method, ''),
			approved_at,
			vat,
			supplied_amount,
			tax_free_amount,
			pos_sync_status,
			COALESCE(pos_order_id, ''),
			COALESCE(pos_sync_error, ''),
			created_at
		FROM payment_orders
		WHERE id = $1
	`, strings.TrimSpace(orderID)).Scan(
		&order.OrderID,
		&order.MenuItemID,
		&order.TossCatalogItemID,
		&order.MenuItemName,
		&order.CategoryName,
		&order.TableNumber,
		&order.RequestNote,
		&order.Amount,
		&order.Status,
		&order.PaymentKey,
		&order.PaymentMethod,
		&approvedAt,
		&order.VAT,
		&order.SuppliedAmount,
		&order.TaxFreeAmount,
		&order.POSSyncStatus,
		&order.POSOrderID,
		&order.POSSyncError,
		&createdAt,
	)
	if err != nil {
		return PaymentOrder{}, classifyError(err)
	}

	if approvedAt != nil {
		order.ApprovedAt = formatTimestamp(*approvedAt)
	}
	order.CreatedAt = formatTimestamp(createdAt)
	optionRows, optionErr := r.pool.Query(ctx, `
		SELECT option_id, option_choice_id, option_title, option_choice_title, price_value, quantity
		FROM payment_order_option_choices
		WHERE order_id = $1
		ORDER BY option_title, option_choice_title, option_choice_id
	`, order.OrderID)
	if optionErr != nil {
		return PaymentOrder{}, optionErr
	}
	defer optionRows.Close()
	for optionRows.Next() {
		var choice PaymentOrderOptionChoice
		if err := optionRows.Scan(&choice.OptionID, &choice.OptionChoiceID, &choice.OptionTitle, &choice.ChoiceTitle, &choice.PriceValue, &choice.Quantity); err != nil {
			return PaymentOrder{}, err
		}
		order.OptionChoices = append(order.OptionChoices, choice)
	}
	if err := optionRows.Err(); err != nil {
		return PaymentOrder{}, err
	}
	return order, nil
}

type CompletePaymentOrderInput struct {
	PaymentKey     string
	PaymentMethod  string
	ApprovedAt     time.Time
	VAT            int64
	SuppliedAmount int64
	TaxFreeAmount  int64
}

func (r *Repository) CompletePaymentOrder(ctx context.Context, orderID string, input CompletePaymentOrderInput) (PaymentOrder, error) {
	order, err := r.GetPaymentOrder(ctx, orderID)
	if err != nil {
		return PaymentOrder{}, err
	}

	if order.Status == "DONE" {
		if order.PaymentKey == input.PaymentKey {
			return order, nil
		}
		return PaymentOrder{}, ErrAlreadyExists
	}
	if (order.Status != "READY" && order.Status != "ACKNOWLEDGED") || strings.TrimSpace(input.PaymentKey) == "" {
		return PaymentOrder{}, ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_orders
		SET status = 'DONE',
			payment_key = $2,
			payment_method = $3,
			approved_at = $4,
			vat = $5,
			supplied_amount = $6,
			tax_free_amount = $7,
			updated_at = NOW()
		WHERE id = $1 AND status IN ('READY', 'ACKNOWLEDGED')
	`, orderID, input.PaymentKey, input.PaymentMethod, input.ApprovedAt, input.VAT, input.SuppliedAmount, input.TaxFreeAmount)
	if err != nil {
		return PaymentOrder{}, classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return PaymentOrder{}, ErrAlreadyExists
	}

	return r.GetPaymentOrder(ctx, orderID)
}

// CompletePaymentOrderFromPOS records a POS (offline card/cash) payment
// observed via a TossPlace order.order.completed.v1 webhook — see
// internal/httpapi/tossplace_webhooks.go. It is a distinct method from
// CompletePaymentOrder (the in-app Toss Payments flow) rather than a shared
// code path because that method requires a non-empty PaymentKey, which a POS
// payment never has; keeping them separate avoids weakening that existing
// validation for the app flow.
//
// Accepts both READY and ACKNOWLEDGED source orders — ACKNOWLEDGED marks
// that staff acknowledged the order in the admin screen, which does not
// block POS payment from completing it.
//
// Idempotent for retried webhook deliveries: an already-DONE order is
// returned unchanged rather than erroring. An already-CANCELLED order
// returns ErrInvalidInput — a cancelled order must never be silently
// resurrected into DONE by a stale/out-of-order webhook delivery.
func (r *Repository) CompletePaymentOrderFromPOS(ctx context.Context, orderID string, approvedAt time.Time, vat int64, suppliedAmount int64, taxFreeAmount int64) (PaymentOrder, error) {
	order, err := r.GetPaymentOrder(ctx, orderID)
	if err != nil {
		return PaymentOrder{}, err
	}

	if order.Status == "DONE" {
		return order, nil
	}
	if order.Status != "READY" && order.Status != "ACKNOWLEDGED" {
		return PaymentOrder{}, ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_orders
		SET status = 'DONE',
			payment_method = 'POS',
			approved_at = $2,
			vat = $3,
			supplied_amount = $4,
			tax_free_amount = $5,
			updated_at = NOW()
		WHERE id = $1 AND status IN ('READY', 'ACKNOWLEDGED')
	`, orderID, approvedAt, vat, suppliedAmount, taxFreeAmount)
	if err != nil {
		return PaymentOrder{}, classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return PaymentOrder{}, ErrAlreadyExists
	}

	return r.GetPaymentOrder(ctx, orderID)
}

// CancelPaymentOrder marks an order CANCELLED after a TossPlace
// order.order.cancelled.v1 webhook — the order was rejected, or a
// previously-completed POS sale was later refunded/voided (TossPlace fires
// this event for READY, ACKNOWLEDGED, and DONE orders). No cancelled_at
// column is added; updated_at records when the cancellation was observed.
//
// Idempotent for retried webhook deliveries: an already-CANCELLED order is
// returned unchanged rather than erroring.
func (r *Repository) CancelPaymentOrder(ctx context.Context, orderID string, cancelledAt time.Time) (PaymentOrder, error) {
	order, err := r.GetPaymentOrder(ctx, orderID)
	if err != nil {
		return PaymentOrder{}, err
	}

	if order.Status == "CANCELLED" {
		return order, nil
	}

	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_orders
		SET status = 'CANCELLED',
			updated_at = NOW()
		WHERE id = $1 AND status IN ('READY', 'ACKNOWLEDGED', 'DONE')
	`, orderID)
	if err != nil {
		return PaymentOrder{}, classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return PaymentOrder{}, ErrAlreadyExists
	}

	return r.GetPaymentOrder(ctx, orderID)
}

// AcknowledgePaymentOrder transitions an order from READY to ACKNOWLEDGED —
// the one manual status change staff can make from the admin screen,
// recording that the kitchen/bar has seen the order. DONE and CANCELLED
// remain webhook-only: staff can never set them directly (see
// httpapi's admin payment-order status route).
//
// Idempotent for repeated clicks: an already-ACKNOWLEDGED order is returned
// unchanged rather than erroring, so double-clicking the admin button never
// surfaces an error toast. DONE and CANCELLED orders are rejected with
// ErrInvalidInput — acknowledgement only makes sense before payment settles.
//
// Returns the admin read shape (lamdata.PaymentOrder), matching
// GetPaymentOrderForAdmin, since this is exclusively an admin-screen action.
func (r *Repository) AcknowledgePaymentOrder(ctx context.Context, orderID string) (lamdata.PaymentOrder, error) {
	order, err := r.GetPaymentOrderForAdmin(ctx, orderID)
	if err != nil {
		return lamdata.PaymentOrder{}, err
	}

	if order.Status == "ACKNOWLEDGED" {
		return order, nil
	}
	if order.Status != "READY" {
		return lamdata.PaymentOrder{}, ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_orders
		SET status = 'ACKNOWLEDGED',
			updated_at = NOW()
		WHERE id = $1 AND status = 'READY'
	`, orderID)
	if err != nil {
		return lamdata.PaymentOrder{}, classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return lamdata.PaymentOrder{}, ErrAlreadyExists
	}

	return r.GetPaymentOrderForAdmin(ctx, orderID)
}

// PaymentOrderFilter is the parsed, validated filter/sort/page input for
// ListPaymentOrdersPage, mirroring CustomerRequestFilter/SpecialRequestFilter's
// shape and validation style.
type PaymentOrderFilter struct {
	Status        string // "" = all | "READY" | "ACKNOWLEDGED" | "DONE" | "CANCELLED"
	PosSyncStatus string // "" = all | "PENDING" | "SUCCEEDED" | "FAILED" | "NOT_CONFIGURED"
	Search        string
	From          *time.Time // inclusive
	To            *time.Time // exclusive
	Sort          string     // "createdAt" | "amount"
	Order         string     // "asc" | "desc"
	Page          int
	PageSize      int
}

func paymentOrderOrderByClause(sort string, order string) (string, error) {
	direction := "DESC"
	if order == "asc" {
		direction = "ASC"
	} else if order != "desc" && order != "" {
		return "", fmt.Errorf("%w: order %q", ErrInvalidInput, order)
	}

	switch sort {
	case "createdAt", "":
		return "created_at " + direction + ", id " + direction, nil
	case "amount":
		return "amount " + direction + ", created_at DESC, id DESC", nil
	default:
		return "", fmt.Errorf("%w: sort %q", ErrInvalidInput, sort)
	}
}

const paymentOrderFilterWhere = `
	WHERE ($1 = '' OR status = $1)
	  AND ($2 = '' OR pos_sync_status = $2)
	  AND ($3::timestamptz IS NULL OR created_at >= $3)
	  AND ($4::timestamptz IS NULL OR created_at < $4)
	  AND ($5 = '' OR table_number ILIKE $5 ESCAPE '\' OR menu_item_name ILIKE $5 ESCAPE '\')
`

// ListPaymentOrdersPage applies filter/search/sort/pagination server-side for
// the admin order-history screen and reports the total matching row count
// alongside the current page, mirroring ListCustomerRequestsPage/
// ListSpecialRequestsPage. Unlike those, there is no legacy unpaginated
// array response to preserve here — this is a new endpoint, so it always
// returns the paginated shape.
func (r *Repository) ListPaymentOrdersPage(ctx context.Context, filter PaymentOrderFilter) ([]lamdata.PaymentOrder, int, error) {
	orderBy, err := paymentOrderOrderByClause(filter.Sort, filter.Order)
	if err != nil {
		return nil, 0, err
	}

	page := clampListPage(filter.Page)
	pageSize := clampListPageSize(filter.PageSize)
	searchPattern := searchPatternOrEmpty(filter.Search)

	var total int
	countSQL := "SELECT COUNT(*) FROM payment_orders" + paymentOrderFilterWhere
	if err := r.pool.QueryRow(ctx, countSQL, filter.Status, filter.PosSyncStatus, filter.From, filter.To, searchPattern).Scan(&total); err != nil {
		return nil, 0, err
	}

	listSQL := `
		SELECT
			id,
			COALESCE(menu_item_id, ''),
			menu_item_name,
			category_name,
			table_number,
			request_note,
			amount,
			vat,
			supplied_amount,
			tax_free_amount,
			status,
			COALESCE(payment_method, ''),
			COALESCE(payment_key, ''),
			approved_at,
			pos_sync_status,
			COALESCE(pos_order_id, ''),
			COALESCE(pos_sync_error, ''),
			created_at
		FROM payment_orders
	` + paymentOrderFilterWhere + `
		ORDER BY ` + orderBy + `
		LIMIT $6 OFFSET $7
	`
	offset := (page - 1) * pageSize
	rows, err := r.pool.Query(ctx, listSQL, filter.Status, filter.PosSyncStatus, filter.From, filter.To, searchPattern, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	orders := make([]lamdata.PaymentOrder, 0)
	for rows.Next() {
		var item lamdata.PaymentOrder
		var approvedAt *time.Time
		var createdAt time.Time
		if err := rows.Scan(
			&item.OrderID,
			&item.MenuItemID,
			&item.MenuItemName,
			&item.CategoryName,
			&item.TableNumber,
			&item.RequestNote,
			&item.Amount,
			&item.VAT,
			&item.SuppliedAmount,
			&item.TaxFreeAmount,
			&item.Status,
			&item.PaymentMethod,
			&item.PaymentKey,
			&approvedAt,
			&item.POSSyncStatus,
			&item.POSOrderID,
			&item.POSSyncError,
			&createdAt,
		); err != nil {
			return nil, 0, err
		}
		if approvedAt != nil {
			item.ApprovedAt = formatTimestamp(*approvedAt)
		}
		item.CreatedAt = formatTimestamp(createdAt)
		orders = append(orders, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}

	return orders, total, nil
}

// GetPaymentOrderForAdmin fetches a single order in the admin read shape
// (lamdata.PaymentOrder — see ListPaymentOrdersPage's doc comment for why
// this is a distinct type from the customer-facing PaymentOrder above).
// Returns ErrNotFound (via classifyError) when no row matches id.
func (r *Repository) GetPaymentOrderForAdmin(ctx context.Context, orderID string) (lamdata.PaymentOrder, error) {
	var item lamdata.PaymentOrder
	var approvedAt *time.Time
	var createdAt time.Time
	err := r.pool.QueryRow(ctx, `
		SELECT
			id,
			COALESCE(menu_item_id, ''),
			menu_item_name,
			category_name,
			table_number,
			request_note,
			amount,
			vat,
			supplied_amount,
			tax_free_amount,
			status,
			COALESCE(payment_method, ''),
			COALESCE(payment_key, ''),
			approved_at,
			pos_sync_status,
			COALESCE(pos_order_id, ''),
			COALESCE(pos_sync_error, ''),
			created_at
		FROM payment_orders
		WHERE id = $1
	`, strings.TrimSpace(orderID)).Scan(
		&item.OrderID,
		&item.MenuItemID,
		&item.MenuItemName,
		&item.CategoryName,
		&item.TableNumber,
		&item.RequestNote,
		&item.Amount,
		&item.VAT,
		&item.SuppliedAmount,
		&item.TaxFreeAmount,
		&item.Status,
		&item.PaymentMethod,
		&item.PaymentKey,
		&approvedAt,
		&item.POSSyncStatus,
		&item.POSOrderID,
		&item.POSSyncError,
		&createdAt,
	)
	if err != nil {
		return lamdata.PaymentOrder{}, classifyError(err)
	}

	if approvedAt != nil {
		item.ApprovedAt = formatTimestamp(*approvedAt)
	}
	item.CreatedAt = formatTimestamp(createdAt)
	return item, nil
}

func (r *Repository) UpdatePaymentOrderPOSSync(ctx context.Context, orderID string, status string, posOrderID string, syncError string) error {
	if status != "SUCCEEDED" && status != "FAILED" && status != "NOT_CONFIGURED" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_orders
		SET pos_sync_status = $2,
			pos_order_id = NULLIF($3, ''),
			pos_sync_error = NULLIF($4, ''),
			updated_at = NOW()
		WHERE id = $1
	`, orderID, status, strings.TrimSpace(posOrderID), strings.TrimSpace(syncError))
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) MarkPaymentOrderPOSReady(ctx context.Context, orderID string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_orders
		SET pos_claim_ready = TRUE,
			pos_sync_status = 'PENDING',
			pos_sync_error = NULL,
			updated_at = NOW()
		WHERE id = $1
	`, strings.TrimSpace(orderID))
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) ClaimPendingPOSPluginOrder(ctx context.Context) (POSPluginOrderClaim, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return POSPluginOrderClaim{}, err
	}
	defer tx.Rollback(ctx)

	var orderID string
	err = tx.QueryRow(ctx, `
		SELECT id
		FROM payment_orders
		WHERE pos_sync_status = 'PENDING'
			AND pos_claim_ready = TRUE
			AND toss_catalog_item_id IS NOT NULL
			AND (pos_claimed_at IS NULL OR pos_claimed_at < NOW() - INTERVAL '2 minutes')
		ORDER BY created_at, id
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`).Scan(&orderID)
	if err != nil {
		return POSPluginOrderClaim{}, classifyError(err)
	}

	claimBytes := make([]byte, 24)
	if _, err := rand.Read(claimBytes); err != nil {
		return POSPluginOrderClaim{}, err
	}
	claimToken := hex.EncodeToString(claimBytes)
	if _, err := tx.Exec(ctx, `
		UPDATE payment_orders
		SET pos_claim_token = $2,
			pos_claimed_at = NOW(),
			pos_sync_error = NULL,
			updated_at = NOW()
		WHERE id = $1
	`, orderID, claimToken); err != nil {
		return POSPluginOrderClaim{}, classifyError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return POSPluginOrderClaim{}, err
	}

	order, err := r.GetPaymentOrder(ctx, orderID)
	if err != nil {
		return POSPluginOrderClaim{}, err
	}
	baseAmount := order.Amount
	for _, choice := range order.OptionChoices {
		baseAmount -= choice.PriceValue * choice.Quantity
	}
	return POSPluginOrderClaim{
		ClaimToken: claimToken,
		Order: POSPluginOrder{
			OrderID: order.OrderID, TableNumber: order.TableNumber,
			CatalogItemID: order.TossCatalogItemID, MenuItemName: order.MenuItemName,
			CategoryName: order.CategoryName, RequestNote: order.RequestNote,
			Amount: order.Amount, BaseAmount: baseAmount, OptionChoices: order.OptionChoices,
		},
	}, nil
}

func (r *Repository) CompletePOSPluginOrder(ctx context.Context, orderID string, claimToken string, posOrderID string) error {
	orderID = strings.TrimSpace(orderID)
	claimToken = strings.TrimSpace(claimToken)
	posOrderID = strings.TrimSpace(posOrderID)
	if orderID == "" || claimToken == "" || posOrderID == "" {
		return ErrInvalidInput
	}

	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_orders
		SET pos_sync_status = 'SUCCEEDED',
			pos_order_id = $3,
			pos_sync_error = NULL,
			pos_claim_token = NULL,
			pos_claimed_at = NULL,
			updated_at = NOW()
		WHERE id = $1
			AND pos_sync_status = 'PENDING'
			AND pos_claim_token = $2
	`, orderID, claimToken, posOrderID)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	var status string
	var storedPOSOrderID string
	err = r.pool.QueryRow(ctx, `
		SELECT pos_sync_status, COALESCE(pos_order_id, '')
		FROM payment_orders
		WHERE id = $1
	`, orderID).Scan(&status, &storedPOSOrderID)
	if err != nil {
		return classifyError(err)
	}
	if status == "SUCCEEDED" && storedPOSOrderID == posOrderID {
		return nil
	}
	return ErrInvalidInput
}

func (r *Repository) FailPOSPluginOrder(ctx context.Context, orderID string, claimToken string, syncError string) error {
	orderID = strings.TrimSpace(orderID)
	claimToken = strings.TrimSpace(claimToken)
	syncError = strings.TrimSpace(syncError)
	if orderID == "" || claimToken == "" || syncError == "" {
		return ErrInvalidInput
	}
	if len([]rune(syncError)) > 300 {
		syncError = string([]rune(syncError)[:300])
	}

	tag, err := r.pool.Exec(ctx, `
		UPDATE payment_orders
		SET pos_sync_error = $3,
			pos_claim_token = NULL,
			pos_claimed_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
			AND pos_sync_status = 'PENDING'
			AND pos_claim_token = $2
	`, orderID, claimToken, syncError)
	if err != nil {
		return classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrInvalidInput
	}
	return nil
}

// paymentOrderStatsFilterWhere restricts every stats query to DONE orders
// (READY orders never contributed revenue) approved within [from, to).
const paymentOrderStatsFilterWhere = `
	WHERE status = 'DONE' AND approved_at >= $1 AND approved_at < $2
`

// determineTrendUnit picks the trend chart's bucket granularity from the
// requested range's length, so the admin never has to pick a unit that
// would render either a single bar (too coarse) or hundreds of them (too
// fine) for the range they chose.
func determineTrendUnit(from time.Time, to time.Time) string {
	days := to.Sub(from).Hours() / 24
	switch {
	case days <= 31:
		return "day"
	case days <= 180:
		return "week"
	default:
		return "month"
	}
}

// GetPaymentOrderStats aggregates DONE orders approved within [from, to)
// for the admin sales-stats screen: a summary (total revenue, order count,
// average order value), a trend broken into day/week/month buckets (picked
// by determineTrendUnit), and revenue/count breakdowns by category, payment
// method, and table.
//
// Bucketing/grouping is done in Postgres via GROUP BY rather than in Go, so
// arbitrarily large ranges never have to pull every matching row into
// application memory just to sum them.
//
// The trend buckets are computed on `approved_at AT TIME ZONE 'Asia/Seoul'`
// — a KST wall-clock conversion scoped to this one query, not a
// server-wide timezone policy (contrast `formatTimestamp`, which always
// stores/serializes in UTC, and the order-history list filter, whose
// from/to bounds are pre-computed by the browser instead). A range here can
// split into an arbitrary, unbounded number of buckets, so — unlike the
// list filter's fixed from/to pair — there's no fixed set of boundaries the
// browser could precompute; the bucketing has to happen in SQL. Korea is
// this store's only market today, so the fixed 'Asia/Seoul' literal is
// fine.
//
// businessDayBasis switches the trend buckets between plain KST-calendar
// boundaries (midnight-to-midnight) and the venue's buffered business day
// (16:00-06:00, matching `lam-admin-web`'s `features/orders/business-day.ts`)
// — shifting the timestamp back 16 hours before truncating to the bucket
// unit, then shifting the truncated boundary forward again by the same 16
// hours, is the standard trick for truncating to an offset day/week/month
// rather than one starting at midnight.
func (r *Repository) GetPaymentOrderStats(ctx context.Context, from time.Time, to time.Time, businessDayBasis bool) (lamdata.PaymentOrderStats, error) {
	var stats lamdata.PaymentOrderStats

	var totalRevenue int64
	var orderCount int
	summarySQL := "SELECT COALESCE(SUM(amount), 0), COUNT(*) FROM payment_orders" + paymentOrderStatsFilterWhere
	if err := r.pool.QueryRow(ctx, summarySQL, from, to).Scan(&totalRevenue, &orderCount); err != nil {
		return lamdata.PaymentOrderStats{}, classifyError(err)
	}
	stats.Summary = lamdata.PaymentOrderStatsSummary{
		TotalRevenue: totalRevenue,
		OrderCount:   orderCount,
	}
	if orderCount > 0 {
		stats.Summary.AverageOrderValue = int64(math.Round(float64(totalRevenue) / float64(orderCount)))
	}

	unit := determineTrendUnit(from, to)
	trendSQL := `
		SELECT
			TO_CHAR(
				CASE WHEN $4 THEN
					date_trunc($3, (approved_at AT TIME ZONE 'Asia/Seoul') - INTERVAL '16 hours') + INTERVAL '16 hours'
				ELSE
					date_trunc($3, approved_at AT TIME ZONE 'Asia/Seoul')
				END,
				'YYYY-MM-DD'
			) AS bucket,
			COALESCE(SUM(amount), 0),
			COUNT(*)
		FROM payment_orders
	` + paymentOrderStatsFilterWhere + `
		GROUP BY bucket
		ORDER BY bucket ASC
	`
	trendRows, err := r.pool.Query(ctx, trendSQL, from, to, unit, businessDayBasis)
	if err != nil {
		return lamdata.PaymentOrderStats{}, classifyError(err)
	}
	buckets := make([]lamdata.PaymentOrderTrendBucket, 0)
	for trendRows.Next() {
		var bucket lamdata.PaymentOrderTrendBucket
		if err := trendRows.Scan(&bucket.Bucket, &bucket.Revenue, &bucket.OrderCount); err != nil {
			trendRows.Close()
			return lamdata.PaymentOrderStats{}, err
		}
		buckets = append(buckets, bucket)
	}
	trendRows.Close()
	if err := trendRows.Err(); err != nil {
		return lamdata.PaymentOrderStats{}, err
	}
	stats.Trend = lamdata.PaymentOrderTrend{Unit: unit, Buckets: buckets}

	categorySQL := `
		SELECT category_name, COALESCE(SUM(amount), 0), COUNT(*)
		FROM payment_orders
	` + paymentOrderStatsFilterWhere + `
		GROUP BY category_name
		ORDER BY SUM(amount) DESC
	`
	categoryRows, err := r.pool.Query(ctx, categorySQL, from, to)
	if err != nil {
		return lamdata.PaymentOrderStats{}, classifyError(err)
	}
	stats.ByCategory = make([]lamdata.PaymentOrderCategoryStat, 0)
	for categoryRows.Next() {
		var row lamdata.PaymentOrderCategoryStat
		if err := categoryRows.Scan(&row.CategoryName, &row.Revenue, &row.OrderCount); err != nil {
			categoryRows.Close()
			return lamdata.PaymentOrderStats{}, err
		}
		stats.ByCategory = append(stats.ByCategory, row)
	}
	categoryRows.Close()
	if err := categoryRows.Err(); err != nil {
		return lamdata.PaymentOrderStats{}, err
	}

	paymentMethodSQL := `
		SELECT COALESCE(payment_method, ''), COALESCE(SUM(amount), 0), COUNT(*)
		FROM payment_orders
	` + paymentOrderStatsFilterWhere + `
		GROUP BY payment_method
		ORDER BY SUM(amount) DESC
	`
	paymentMethodRows, err := r.pool.Query(ctx, paymentMethodSQL, from, to)
	if err != nil {
		return lamdata.PaymentOrderStats{}, classifyError(err)
	}
	stats.ByPaymentMethod = make([]lamdata.PaymentOrderPaymentMethodStat, 0)
	for paymentMethodRows.Next() {
		var row lamdata.PaymentOrderPaymentMethodStat
		if err := paymentMethodRows.Scan(&row.PaymentMethod, &row.Revenue, &row.OrderCount); err != nil {
			paymentMethodRows.Close()
			return lamdata.PaymentOrderStats{}, err
		}
		stats.ByPaymentMethod = append(stats.ByPaymentMethod, row)
	}
	paymentMethodRows.Close()
	if err := paymentMethodRows.Err(); err != nil {
		return lamdata.PaymentOrderStats{}, err
	}

	tableSQL := `
		SELECT table_number, COALESCE(SUM(amount), 0), COUNT(*)
		FROM payment_orders
	` + paymentOrderStatsFilterWhere + `
		GROUP BY table_number
		ORDER BY SUM(amount) DESC
	`
	tableRows, err := r.pool.Query(ctx, tableSQL, from, to)
	if err != nil {
		return lamdata.PaymentOrderStats{}, classifyError(err)
	}
	stats.ByTable = make([]lamdata.PaymentOrderTableStat, 0)
	for tableRows.Next() {
		var row lamdata.PaymentOrderTableStat
		if err := tableRows.Scan(&row.TableNumber, &row.Revenue, &row.OrderCount); err != nil {
			tableRows.Close()
			return lamdata.PaymentOrderStats{}, err
		}
		stats.ByTable = append(stats.ByTable, row)
	}
	tableRows.Close()
	if err := tableRows.Err(); err != nil {
		return lamdata.PaymentOrderStats{}, err
	}

	menuItemSQL := `
		SELECT menu_item_name, COALESCE(SUM(amount), 0), COUNT(*)
		FROM payment_orders
	` + paymentOrderStatsFilterWhere + `
		GROUP BY menu_item_name
		ORDER BY SUM(amount) DESC
	`
	menuItemRows, err := r.pool.Query(ctx, menuItemSQL, from, to)
	if err != nil {
		return lamdata.PaymentOrderStats{}, classifyError(err)
	}
	stats.ByMenuItem = make([]lamdata.PaymentOrderMenuItemStat, 0)
	for menuItemRows.Next() {
		var row lamdata.PaymentOrderMenuItemStat
		if err := menuItemRows.Scan(&row.MenuItemName, &row.Revenue, &row.OrderCount); err != nil {
			menuItemRows.Close()
			return lamdata.PaymentOrderStats{}, err
		}
		stats.ByMenuItem = append(stats.ByMenuItem, row)
	}
	menuItemRows.Close()
	if err := menuItemRows.Err(); err != nil {
		return lamdata.PaymentOrderStats{}, err
	}

	return stats, nil
}
