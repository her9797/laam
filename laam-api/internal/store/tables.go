package store

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// The QR table id format the customer web and the admin QR codes use:
// an uppercase area letter, '-', and exactly two digits (T-01, B-03).
var qrTableIDPattern = regexp.MustCompile(`^([A-Z])-([0-9]{2})$`)

// The POS table name rules below mirror laam-pos-plugin's
// order-sync.ts semanticTableName exactly: spaces, '-' and '_' are
// dropped and the comparison is case-insensitive, so "t11", "T 11" and
// "테이블-11" all resolve to the same QR table. Anything else (룸, 테라스,
// …) has no QR counterpart and must be linked by an operator.
var (
	posTitleAreaPattern  = regexp.MustCompile(`^([tb])0*([0-9]+)$`)
	posTitleTablePattern = regexp.MustCompile(`^테이블0*([0-9]+)$`)
	posTitleBarPattern   = regexp.MustCompile(`^바(?:자리)?0*([0-9]+)$`)
)

func normalizePOSTableTitle(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return strings.NewReplacer(" ", "", "\t", "", "-", "", "_", "").Replace(normalized)
}

// qrTableIDFromPOSTitle converts a POS table name to the QR table id it
// means, or reports false when the name follows none of the rules.
func qrTableIDFromPOSTitle(title string) (string, bool) {
	normalized := normalizePOSTableTitle(title)

	area := ""
	digits := ""
	switch {
	case posTitleAreaPattern.MatchString(normalized):
		match := posTitleAreaPattern.FindStringSubmatch(normalized)
		area, digits = strings.ToUpper(match[1]), match[2]
	case posTitleTablePattern.MatchString(normalized):
		area, digits = "T", posTitleTablePattern.FindStringSubmatch(normalized)[1]
	case posTitleBarPattern.MatchString(normalized):
		area, digits = "B", posTitleBarPattern.FindStringSubmatch(normalized)[1]
	default:
		return "", false
	}

	number, err := strconv.Atoi(digits)
	if err != nil || number < 1 || number > 99 {
		return "", false
	}
	return fmt.Sprintf("%s-%02d", area, number), true
}

// parseQrTableID splits a QR table id into its area and number, rejecting
// anything that is not in the canonical 'T-01' form.
func parseQrTableID(id string) (string, int, bool) {
	match := qrTableIDPattern.FindStringSubmatch(id)
	if match == nil {
		return "", 0, false
	}
	number, err := strconv.Atoi(match[2])
	if err != nil || number < 1 {
		return "", 0, false
	}
	return match[1], number, true
}

const (
	// MaxPOSTableSnapshotTables caps one uploaded POS table snapshot. The
	// store has far fewer tables than this; the limit only keeps a broken
	// or hostile plugin from writing an unbounded snapshot.
	MaxPOSTableSnapshotTables = 300

	// posTableSyncTimeoutSeconds is how long a requested sync may stay
	// unfinished before the POS plugin is considered gone. Both the
	// single-request lookup and the admin listing apply it, so a dead
	// plugin never leaves the admin screen waiting forever.
	posTableSyncTimeoutSeconds = 30
	posTableSyncTimeoutMessage = "POS 플러그인이 30초 안에 응답하지 않았습니다"

	// posTableSyncLockKey serializes sync request creation across API
	// instances. Two admins pressing "동기화" at the same moment must end up
	// with one PENDING request, and an advisory lock is the only guard that
	// works when the row does not exist yet.
	posTableSyncLockKey = 815234907
)

type QrTable struct {
	ID            string
	Area          string
	Number        int
	POSTableID    *int64
	POSTableTitle *string
	HallName      *string
	LinkedAt      *time.Time
}

type POSTable struct {
	POSTableID int64     `json:"posTableId"`
	Title      string    `json:"title"`
	HallID     *int64    `json:"hallId"`
	HallName   *string   `json:"hallName"`
	Capacity   *int      `json:"capacity"`
	SyncedAt   time.Time `json:"syncedAt"`
	QrTableID  *string   `json:"qrTableId"`
}

type POSTableSync struct {
	ID            string     `json:"id"`
	Status        string     `json:"status"`
	RequestedAt   time.Time  `json:"requestedAt"`
	CompletedAt   *time.Time `json:"completedAt"`
	LinkedCount   int        `json:"linkedCount"`
	UnlinkedCount int        `json:"unlinkedCount"`
	POSOnlyCount  int        `json:"posOnlyCount"`
	Error         *string    `json:"error"`
}

// TableLinkOverview is everything the admin table screen needs in one read.
type TableLinkOverview struct {
	Tables        []QrTable
	POSOnlyTables []POSTable
	LastSyncedAt  *time.Time
	PendingSync   *POSTableSync
}

type POSHallInput struct {
	ID   int64
	Name string
}

type POSTableInput struct {
	ID       int64
	Title    string
	HallID   *int64
	Capacity *int
}

type POSTableSnapshotInput struct {
	Halls  []POSHallInput
	Tables []POSTableInput
}

// POSTableMappings is the QR table id → POS table id map the plugin polls.
type POSTableMappings struct {
	Mappings  map[string]int64 `json:"mappings"`
	UpdatedAt *time.Time       `json:"updatedAt"`
}

// tableQuerier is satisfied by both *pgxpool.Pool and pgx.Tx so the same
// readers work inside and outside a transaction.
type tableQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

func utcPtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	utc := value.UTC()
	return &utc
}

// expirePOSTableSyncRequests flips every request that has been waiting
// longer than the timeout to TIMED_OUT. Every read path calls it first so
// the admin screen and the single-request poll can never disagree.
func expirePOSTableSyncRequests(ctx context.Context, q tableQuerier) error {
	_, err := q.Exec(ctx, `
		UPDATE pos_table_sync_requests
		SET status = 'TIMED_OUT',
			completed_at = NOW(),
			error = COALESCE(error, $2)
		WHERE status IN ('PENDING', 'RUNNING')
			AND requested_at < NOW() - make_interval(secs => $1)
	`, posTableSyncTimeoutSeconds, posTableSyncTimeoutMessage)
	return err
}

const posTableSyncColumns = `id, status, requested_at, completed_at, linked_count, unlinked_count, pos_only_count, error`

func scanPOSTableSync(row pgx.Row) (POSTableSync, error) {
	var sync POSTableSync
	var completedAt *time.Time
	if err := row.Scan(&sync.ID, &sync.Status, &sync.RequestedAt, &completedAt,
		&sync.LinkedCount, &sync.UnlinkedCount, &sync.POSOnlyCount, &sync.Error); err != nil {
		return POSTableSync{}, err
	}
	sync.RequestedAt = sync.RequestedAt.UTC()
	sync.CompletedAt = utcPtr(completedAt)
	return sync, nil
}

func listQrTables(ctx context.Context, q tableQuerier) ([]QrTable, error) {
	rows, err := q.Query(ctx, `
		SELECT q.id, q.area, q.number, q.pos_table_id, p.title, p.hall_name, q.linked_at
		FROM qr_tables q
		LEFT JOIN pos_tables p ON p.pos_table_id = q.pos_table_id
		ORDER BY q.area, q.number, q.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := make([]QrTable, 0)
	for rows.Next() {
		var table QrTable
		var linkedAt *time.Time
		if err := rows.Scan(&table.ID, &table.Area, &table.Number, &table.POSTableID,
			&table.POSTableTitle, &table.HallName, &linkedAt); err != nil {
			return nil, err
		}
		table.LinkedAt = utcPtr(linkedAt)
		tables = append(tables, table)
	}
	return tables, rows.Err()
}

func getQrTable(ctx context.Context, q tableQuerier, id string) (QrTable, error) {
	var table QrTable
	var linkedAt *time.Time
	err := q.QueryRow(ctx, `
		SELECT q.id, q.area, q.number, q.pos_table_id, p.title, p.hall_name, q.linked_at
		FROM qr_tables q
		LEFT JOIN pos_tables p ON p.pos_table_id = q.pos_table_id
		WHERE q.id = $1
	`, id).Scan(&table.ID, &table.Area, &table.Number, &table.POSTableID,
		&table.POSTableTitle, &table.HallName, &linkedAt)
	if err != nil {
		return QrTable{}, classifyError(err)
	}
	table.LinkedAt = utcPtr(linkedAt)
	return table, nil
}

// GetTableLinkOverview returns the QR tables with their POS snapshot data,
// the POS tables no QR table points at, when the snapshot was last taken
// and the sync still in flight, if any.
func (r *Repository) GetTableLinkOverview(ctx context.Context) (TableLinkOverview, error) {
	if err := expirePOSTableSyncRequests(ctx, r.pool); err != nil {
		return TableLinkOverview{}, err
	}

	tables, err := listQrTables(ctx, r.pool)
	if err != nil {
		return TableLinkOverview{}, err
	}

	rows, err := r.pool.Query(ctx, `
		SELECT p.pos_table_id, p.title, p.hall_id, p.hall_name, p.capacity, p.synced_at, q.id
		FROM pos_tables p
		LEFT JOIN qr_tables q ON q.pos_table_id = p.pos_table_id
		WHERE q.id IS NULL
		ORDER BY p.title, p.pos_table_id
	`)
	if err != nil {
		return TableLinkOverview{}, err
	}
	defer rows.Close()

	posOnly := make([]POSTable, 0)
	for rows.Next() {
		var table POSTable
		if err := rows.Scan(&table.POSTableID, &table.Title, &table.HallID,
			&table.HallName, &table.Capacity, &table.SyncedAt, &table.QrTableID); err != nil {
			return TableLinkOverview{}, err
		}
		table.SyncedAt = table.SyncedAt.UTC()
		posOnly = append(posOnly, table)
	}
	if err := rows.Err(); err != nil {
		return TableLinkOverview{}, err
	}

	var lastSyncedAt *time.Time
	if err := r.pool.QueryRow(ctx, `
		SELECT GREATEST(
			(SELECT MAX(synced_at) FROM pos_tables),
			(SELECT MAX(completed_at) FROM pos_table_sync_requests WHERE status = 'DONE')
		)
	`).Scan(&lastSyncedAt); err != nil {
		return TableLinkOverview{}, err
	}

	var pending *POSTableSync
	sync, err := scanPOSTableSync(r.pool.QueryRow(ctx, `
		SELECT `+posTableSyncColumns+`
		FROM pos_table_sync_requests
		WHERE status IN ('PENDING', 'RUNNING')
		ORDER BY requested_at DESC, id DESC
		LIMIT 1
	`))
	switch {
	case err == nil:
		pending = &sync
	case classifyError(err) == ErrNotFound:
	default:
		return TableLinkOverview{}, err
	}

	return TableLinkOverview{
		Tables:        tables,
		POSOnlyTables: posOnly,
		LastSyncedAt:  utcPtr(lastSyncedAt),
		PendingSync:   pending,
	}, nil
}

// LinkQrTablePOSTable links a QR table to a POS table from the current
// snapshot, or clears the link when posTableID is nil.
func (r *Repository) LinkQrTablePOSTable(ctx context.Context, qrTableID string, posTableID *int64) (QrTable, error) {
	qrTableID = strings.TrimSpace(qrTableID)
	if qrTableID == "" {
		return QrTable{}, ErrInvalidInput
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return QrTable{}, err
	}
	defer tx.Rollback(ctx)

	var existingID string
	if err := tx.QueryRow(ctx, `SELECT id FROM qr_tables WHERE id = $1 FOR UPDATE`, qrTableID).Scan(&existingID); err != nil {
		return QrTable{}, classifyError(err)
	}

	if posTableID == nil {
		if _, err := tx.Exec(ctx, `
			UPDATE qr_tables SET pos_table_id = NULL, linked_at = NULL WHERE id = $1
		`, qrTableID); err != nil {
			return QrTable{}, classifyError(err)
		}
	} else {
		var snapshotID int64
		if err := tx.QueryRow(ctx, `SELECT pos_table_id FROM pos_tables WHERE pos_table_id = $1`, *posTableID).Scan(&snapshotID); err != nil {
			return QrTable{}, classifyError(err)
		}

		var owner string
		err := tx.QueryRow(ctx, `SELECT id FROM qr_tables WHERE pos_table_id = $1 AND id <> $2`, *posTableID, qrTableID).Scan(&owner)
		switch {
		case err == nil:
			return QrTable{}, fmt.Errorf("%w: POS table %d is already linked to %s", ErrAlreadyExists, *posTableID, owner)
		case classifyError(err) == ErrNotFound:
		default:
			return QrTable{}, err
		}

		if _, err := tx.Exec(ctx, `
			UPDATE qr_tables SET pos_table_id = $2, linked_at = NOW() WHERE id = $1
		`, qrTableID, *posTableID); err != nil {
			return QrTable{}, classifyError(err)
		}
	}

	table, err := getQrTable(ctx, tx, qrTableID)
	if err != nil {
		return QrTable{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return QrTable{}, err
	}
	return table, nil
}

// RenameQrTable changes a QR table's own code (its id), keeping whatever
// POS table it is linked to. The seeded layout and the id derived from a
// POS table name are both guesses, so an operator must be able to correct
// one — a table sitting in the bar area but seeded as "T-10", say. The QR
// URL is signed over the id, so a renamed table's printed QR must be
// replaced; callers are expected to say so.
//
// Existing orders and requests keep the old code: they store table_number
// as plain text and are a record of what the guest actually scanned.
func (r *Repository) RenameQrTable(ctx context.Context, qrTableID string, newID string) (QrTable, error) {
	qrTableID = strings.TrimSpace(qrTableID)
	newID = strings.ToUpper(strings.TrimSpace(newID))
	if qrTableID == "" {
		return QrTable{}, ErrInvalidInput
	}
	area, number, ok := parseQrTableID(newID)
	if !ok {
		return QrTable{}, fmt.Errorf("%w: QR table id %q must look like T-01", ErrInvalidInput, newID)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return QrTable{}, err
	}
	defer tx.Rollback(ctx)

	var existingID string
	if err := tx.QueryRow(ctx, `SELECT id FROM qr_tables WHERE id = $1 FOR UPDATE`, qrTableID).Scan(&existingID); err != nil {
		return QrTable{}, classifyError(err)
	}

	if newID != qrTableID {
		var owner string
		err := tx.QueryRow(ctx, `SELECT id FROM qr_tables WHERE id = $1`, newID).Scan(&owner)
		switch {
		case err == nil:
			return QrTable{}, fmt.Errorf("%w: QR table %s already exists", ErrAlreadyExists, owner)
		case classifyError(err) == ErrNotFound:
		default:
			return QrTable{}, err
		}

		if _, err := tx.Exec(ctx, `
			UPDATE qr_tables SET id = $2, area = $3, number = $4, sort_order = $4 WHERE id = $1
		`, qrTableID, newID, area, number); err != nil {
			return QrTable{}, classifyError(err)
		}
	}

	table, err := getQrTable(ctx, tx, newID)
	if err != nil {
		return QrTable{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return QrTable{}, err
	}
	return table, nil
}

// CreateQrTable adds a QR table for a POS table that has no QR counterpart.
// An empty id is derived from the POS table name; a name that follows none
// of the naming rules is rejected so an operator can pick the id instead.
func (r *Repository) CreateQrTable(ctx context.Context, id string, posTableID int64) (QrTable, error) {
	id = strings.TrimSpace(id)
	if id != "" {
		if _, _, ok := parseQrTableID(id); !ok {
			return QrTable{}, fmt.Errorf("%w: QR table id %q must look like T-01", ErrInvalidInput, id)
		}
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return QrTable{}, err
	}
	defer tx.Rollback(ctx)

	var title string
	if err := tx.QueryRow(ctx, `SELECT title FROM pos_tables WHERE pos_table_id = $1`, posTableID).Scan(&title); err != nil {
		return QrTable{}, classifyError(err)
	}

	var owner string
	err = tx.QueryRow(ctx, `SELECT id FROM qr_tables WHERE pos_table_id = $1`, posTableID).Scan(&owner)
	switch {
	case err == nil:
		return QrTable{}, fmt.Errorf("%w: POS table %d is already linked to %s", ErrAlreadyExists, posTableID, owner)
	case classifyError(err) == ErrNotFound:
	default:
		return QrTable{}, err
	}

	if id == "" {
		generated, ok := qrTableIDFromPOSTitle(title)
		if !ok {
			return QrTable{}, fmt.Errorf("%w: cannot derive a QR table id from the POS table name", ErrInvalidInput)
		}
		id = generated
	}

	area, number, ok := parseQrTableID(id)
	if !ok {
		return QrTable{}, fmt.Errorf("%w: QR table id %q must look like T-01", ErrInvalidInput, id)
	}

	tag, err := tx.Exec(ctx, `
		INSERT INTO qr_tables (id, area, number, sort_order, pos_table_id, linked_at)
		VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM qr_tables), $4, NOW())
		ON CONFLICT (id) DO NOTHING
	`, id, area, number, posTableID)
	if err != nil {
		return QrTable{}, classifyError(err)
	}
	if tag.RowsAffected() == 0 {
		return QrTable{}, fmt.Errorf("%w: QR table %s already exists", ErrAlreadyExists, id)
	}

	table, err := getQrTable(ctx, tx, id)
	if err != nil {
		return QrTable{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return QrTable{}, err
	}
	return table, nil
}

// RequestPOSTableSync queues a snapshot request for the POS plugin. It
// reports whether a new request was created; an already waiting or running
// request is returned untouched so pressing the button twice cannot queue
// two snapshots.
func (r *Repository) RequestPOSTableSync(ctx context.Context) (POSTableSync, bool, error) {
	if err := expirePOSTableSyncRequests(ctx, r.pool); err != nil {
		return POSTableSync{}, false, err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return POSTableSync{}, false, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, int64(posTableSyncLockKey)); err != nil {
		return POSTableSync{}, false, err
	}

	existing, err := scanPOSTableSync(tx.QueryRow(ctx, `
		SELECT `+posTableSyncColumns+`
		FROM pos_table_sync_requests
		WHERE status IN ('PENDING', 'RUNNING')
		ORDER BY requested_at DESC, id DESC
		LIMIT 1
	`))
	switch {
	case err == nil:
		if err := tx.Commit(ctx); err != nil {
			return POSTableSync{}, false, err
		}
		return existing, false, nil
	case classifyError(err) == ErrNotFound:
	default:
		return POSTableSync{}, false, err
	}

	created, err := scanPOSTableSync(tx.QueryRow(ctx, `
		INSERT INTO pos_table_sync_requests (id, status)
		VALUES ($1, 'PENDING')
		RETURNING `+posTableSyncColumns+`
	`, nextID("pos-table-sync")))
	if err != nil {
		return POSTableSync{}, false, classifyError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return POSTableSync{}, false, err
	}
	return created, true, nil
}

// GetPOSTableSync reads one sync request, first timing out anything the
// plugin never finished.
func (r *Repository) GetPOSTableSync(ctx context.Context, id string) (POSTableSync, error) {
	if err := expirePOSTableSyncRequests(ctx, r.pool); err != nil {
		return POSTableSync{}, err
	}

	sync, err := scanPOSTableSync(r.pool.QueryRow(ctx, `
		SELECT `+posTableSyncColumns+` FROM pos_table_sync_requests WHERE id = $1
	`, strings.TrimSpace(id)))
	if err != nil {
		return POSTableSync{}, classifyError(err)
	}
	return sync, nil
}

// ClaimPOSTableSync hands the oldest waiting request to the POS plugin and
// marks it RUNNING. It returns ErrNotFound when nothing is waiting.
func (r *Repository) ClaimPOSTableSync(ctx context.Context) (string, error) {
	if err := expirePOSTableSyncRequests(ctx, r.pool); err != nil {
		return "", err
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var id string
	if err := tx.QueryRow(ctx, `
		SELECT id
		FROM pos_table_sync_requests
		WHERE status = 'PENDING'
		ORDER BY requested_at, id
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`).Scan(&id); err != nil {
		return "", classifyError(err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE pos_table_sync_requests SET status = 'RUNNING', started_at = NOW() WHERE id = $1
	`, id); err != nil {
		return "", classifyError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return id, nil
}

// lockUnfinishedPOSTableSync locks one sync request for a terminal update.
// A request the plugin answers after the 30s timeout is still accepted —
// the snapshot it carries is real, and refusing it would leave the store
// permanently stale — but an already finished request is not.
func lockUnfinishedPOSTableSync(ctx context.Context, tx pgx.Tx, id string) error {
	var status string
	if err := tx.QueryRow(ctx, `SELECT status FROM pos_table_sync_requests WHERE id = $1 FOR UPDATE`, id).Scan(&status); err != nil {
		return classifyError(err)
	}
	switch status {
	case "PENDING", "RUNNING", "TIMED_OUT":
		return nil
	default:
		return fmt.Errorf("%w: sync request %s is already %s", ErrInvalidInput, id, status)
	}
}

// CompletePOSTableSync replaces the whole POS table snapshot and re-runs
// name based auto-linking in one transaction, so the admin screen never
// sees a half-written snapshot.
func (r *Repository) CompletePOSTableSync(ctx context.Context, id string, snapshot POSTableSnapshotInput) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrInvalidInput
	}
	if len(snapshot.Tables) > MaxPOSTableSnapshotTables {
		return fmt.Errorf("%w: at most %d POS tables are accepted", ErrInvalidInput, MaxPOSTableSnapshotTables)
	}

	hallNames := make(map[int64]string, len(snapshot.Halls))
	for _, hall := range snapshot.Halls {
		hallNames[hall.ID] = strings.TrimSpace(hall.Name)
	}
	for _, table := range snapshot.Tables {
		if table.ID <= 0 {
			return fmt.Errorf("%w: POS table id must be positive", ErrInvalidInput)
		}
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := lockUnfinishedPOSTableSync(ctx, tx, id); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `DELETE FROM pos_tables`); err != nil {
		return classifyError(err)
	}
	for _, table := range snapshot.Tables {
		var hallName *string
		if table.HallID != nil {
			if name, ok := hallNames[*table.HallID]; ok && name != "" {
				hallName = &name
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO pos_tables (pos_table_id, title, hall_id, hall_name, capacity, synced_at)
			VALUES ($1, $2, $3, $4, $5, NOW())
			ON CONFLICT (pos_table_id) DO UPDATE
			SET title = EXCLUDED.title,
				hall_id = EXCLUDED.hall_id,
				hall_name = EXCLUDED.hall_name,
				capacity = EXCLUDED.capacity,
				synced_at = EXCLUDED.synced_at
		`, table.ID, strings.TrimSpace(table.Title), table.HallID, hallName, table.Capacity); err != nil {
			return classifyError(err)
		}
	}

	// Links whose POS table is gone from the snapshot cannot route an order.
	if _, err := tx.Exec(ctx, `
		UPDATE qr_tables
		SET pos_table_id = NULL, linked_at = NULL
		WHERE pos_table_id IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM pos_tables p WHERE p.pos_table_id = qr_tables.pos_table_id)
	`); err != nil {
		return classifyError(err)
	}

	if err := autoLinkQrTables(ctx, tx); err != nil {
		return err
	}

	if err := createQrTablesForPOSTables(ctx, tx); err != nil {
		return err
	}

	// The POS owns which tables exist; we own their codes. A QR table with no
	// POS counterpart is a table the store no longer has, so it goes — its QR
	// could not route an order anyway. Past orders keep their table_number
	// text, so the history is unaffected.
	if _, err := tx.Exec(ctx, `DELETE FROM qr_tables WHERE pos_table_id IS NULL`); err != nil {
		return classifyError(err)
	}

	var linked, unlinked, posOnly int
	if err := tx.QueryRow(ctx, `
		SELECT
			(SELECT COUNT(*) FROM qr_tables WHERE pos_table_id IS NOT NULL),
			(SELECT COUNT(*) FROM qr_tables WHERE pos_table_id IS NULL),
			(SELECT COUNT(*) FROM pos_tables p WHERE NOT EXISTS (SELECT 1 FROM qr_tables q WHERE q.pos_table_id = p.pos_table_id))
	`).Scan(&linked, &unlinked, &posOnly); err != nil {
		return classifyError(err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE pos_table_sync_requests
		SET status = 'DONE',
			completed_at = NOW(),
			linked_count = $2,
			unlinked_count = $3,
			pos_only_count = $4,
			error = NULL
		WHERE id = $1
	`, id, linked, unlinked, posOnly); err != nil {
		return classifyError(err)
	}

	return tx.Commit(ctx)
}

// autoLinkQrTables links every still unlinked QR table to the single POS
// table whose name resolves to it. Two POS tables resolving to the same QR
// table is ambiguous, so neither is linked and an operator decides.
func autoLinkQrTables(ctx context.Context, tx pgx.Tx) error {
	rows, err := tx.Query(ctx, `
		SELECT p.pos_table_id, p.title
		FROM pos_tables p
		WHERE NOT EXISTS (SELECT 1 FROM qr_tables q WHERE q.pos_table_id = p.pos_table_id)
		ORDER BY p.pos_table_id
	`)
	if err != nil {
		return classifyError(err)
	}
	candidates := make(map[string][]int64)
	for rows.Next() {
		var posTableID int64
		var title string
		if err := rows.Scan(&posTableID, &title); err != nil {
			rows.Close()
			return err
		}
		if qrTableID, ok := qrTableIDFromPOSTitle(title); ok {
			candidates[qrTableID] = append(candidates[qrTableID], posTableID)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	unlinkedRows, err := tx.Query(ctx, `SELECT id FROM qr_tables WHERE pos_table_id IS NULL ORDER BY area, number, id`)
	if err != nil {
		return classifyError(err)
	}
	var unlinkedIDs []string
	for unlinkedRows.Next() {
		var id string
		if err := unlinkedRows.Scan(&id); err != nil {
			unlinkedRows.Close()
			return err
		}
		unlinkedIDs = append(unlinkedIDs, id)
	}
	unlinkedRows.Close()
	if err := unlinkedRows.Err(); err != nil {
		return err
	}

	for _, qrTableID := range unlinkedIDs {
		matches := candidates[qrTableID]
		if len(matches) != 1 {
			continue
		}
		if _, err := tx.Exec(ctx, `
			UPDATE qr_tables SET pos_table_id = $2, linked_at = NOW() WHERE id = $1
		`, qrTableID, matches[0]); err != nil {
			return classifyError(err)
		}
	}
	return nil
}

// FailPOSTableSync records why the POS plugin could not produce a snapshot.
func (r *Repository) FailPOSTableSync(ctx context.Context, id string, message string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrInvalidInput
	}
	message = strings.TrimSpace(message)
	if message == "" {
		message = "POS 테이블 동기화에 실패했습니다"
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := lockUnfinishedPOSTableSync(ctx, tx, id); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE pos_table_sync_requests
		SET status = 'FAILED', completed_at = NOW(), error = $2
		WHERE id = $1
	`, id, message); err != nil {
		return classifyError(err)
	}
	return tx.Commit(ctx)
}

// GetPOSTableMappings returns the confirmed QR table id → POS table id map
// the plugin uses to attach an order to the right POS table.
func (r *Repository) GetPOSTableMappings(ctx context.Context) (POSTableMappings, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, pos_table_id, linked_at
		FROM qr_tables
		WHERE pos_table_id IS NOT NULL
		ORDER BY area, number, id
	`)
	if err != nil {
		return POSTableMappings{}, err
	}
	defer rows.Close()

	mappings := POSTableMappings{Mappings: map[string]int64{}}
	for rows.Next() {
		var id string
		var posTableID int64
		var linkedAt *time.Time
		if err := rows.Scan(&id, &posTableID, &linkedAt); err != nil {
			return POSTableMappings{}, err
		}
		mappings.Mappings[id] = posTableID
		if linkedAt != nil && (mappings.UpdatedAt == nil || linkedAt.After(*mappings.UpdatedAt)) {
			mappings.UpdatedAt = utcPtr(linkedAt)
		}
	}
	if err := rows.Err(); err != nil {
		return POSTableMappings{}, err
	}
	return mappings, nil
}

// ensureOrderTableLinked blocks an order for a table the POS cannot receive
// it on. While no QR table is linked at all the check is skipped: that is
// the state every store is in before the table-linking plugin ships, and
// ordering must keep working there exactly as before.
func ensureOrderTableLinked(ctx context.Context, q tableQuerier, tableNumber string) error {
	var anyLinked, thisLinked bool
	if err := q.QueryRow(ctx, `
		SELECT
			EXISTS (SELECT 1 FROM qr_tables WHERE pos_table_id IS NOT NULL),
			EXISTS (SELECT 1 FROM qr_tables WHERE id = $1 AND pos_table_id IS NOT NULL)
	`, tableNumber).Scan(&anyLinked, &thisLinked); err != nil {
		return classifyError(err)
	}
	if anyLinked && !thisLinked {
		return ErrTableNotLinked
	}
	return nil
}

// createQrTablesForPOSTables gives every still unmatched POS table a QR
// table of its own, using the code its name converts to. A name that
// follows none of the rules — 룸, 테라스 — has no obvious code, so it is
// left for an operator to name; so is a name whose code another table
// already uses, since guessing a different one would be arbitrary.
func createQrTablesForPOSTables(ctx context.Context, tx pgx.Tx) error {
	rows, err := tx.Query(ctx, `
		SELECT p.pos_table_id, p.title
		FROM pos_tables p
		WHERE NOT EXISTS (SELECT 1 FROM qr_tables q WHERE q.pos_table_id = p.pos_table_id)
		ORDER BY p.pos_table_id
	`)
	if err != nil {
		return classifyError(err)
	}
	type candidate struct {
		posTableID int64
		qrTableID  string
	}
	var candidates []candidate
	for rows.Next() {
		var posTableID int64
		var title string
		if err := rows.Scan(&posTableID, &title); err != nil {
			rows.Close()
			return err
		}
		if qrTableID, ok := qrTableIDFromPOSTitle(title); ok {
			candidates = append(candidates, candidate{posTableID: posTableID, qrTableID: qrTableID})
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	for _, entry := range candidates {
		area, number, ok := parseQrTableID(entry.qrTableID)
		if !ok {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO qr_tables (id, area, number, sort_order, pos_table_id, linked_at)
			VALUES ($1, $2, $3, $3, $4, NOW())
			ON CONFLICT (id) DO NOTHING
		`, entry.qrTableID, area, number, entry.posTableID); err != nil {
			return classifyError(err)
		}
	}
	return nil
}
