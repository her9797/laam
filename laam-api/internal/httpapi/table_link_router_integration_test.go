package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/her9797/laam/laam-api/internal/config"
)

func tableLinkConfig() config.Config {
	cfg := testCfg
	cfg.QRSigningSecret = "test-qr-signing-secret"
	cfg.CustomerWebBaseURL = "https://example.test"
	cfg.POSPluginAPIToken = "test-plugin-token"
	return cfg
}

func tableLinkServer(t *testing.T) http.Handler {
	t.Helper()
	return resetServerWithConfig(t, tableLinkConfig())
}

func pluginHeaders() map[string]string {
	return map[string]string{"Authorization": "Bearer " + tableLinkConfig().POSPluginAPIToken}
}

type qrTableBody struct {
	ID            string  `json:"id"`
	Area          string  `json:"area"`
	Number        int     `json:"number"`
	QrURL         string  `json:"qrUrl"`
	POSTableID    *int64  `json:"posTableId"`
	POSTableTitle *string `json:"posTableTitle"`
	HallName      *string `json:"hallName"`
	LinkedAt      *string `json:"linkedAt"`
}

type posTableBody struct {
	POSTableID int64   `json:"posTableId"`
	Title      string  `json:"title"`
	HallID     *int64  `json:"hallId"`
	HallName   *string `json:"hallName"`
	Capacity   *int    `json:"capacity"`
	SyncedAt   string  `json:"syncedAt"`
	QrTableID  *string `json:"qrTableId"`
}

type posTableSyncBody struct {
	ID            string  `json:"id"`
	Status        string  `json:"status"`
	RequestedAt   string  `json:"requestedAt"`
	CompletedAt   *string `json:"completedAt"`
	LinkedCount   int     `json:"linkedCount"`
	UnlinkedCount int     `json:"unlinkedCount"`
	POSOnlyCount  int     `json:"posOnlyCount"`
	Error         *string `json:"error"`
}

type adminTablesBody struct {
	Tables        []qrTableBody     `json:"tables"`
	POSOnlyTables []posTableBody    `json:"posOnlyTables"`
	LastSyncedAt  *string           `json:"lastSyncedAt"`
	PendingSync   *posTableSyncBody `json:"pendingSync"`
}

func decodeTableJSON(t *testing.T, raw []byte, target any) {
	t.Helper()
	if err := json.Unmarshal(raw, target); err != nil {
		t.Fatalf("decode body: %v, body = %s", err, string(raw))
	}
}

func completePluginSnapshot(t *testing.T, handler http.Handler, body string) {
	t.Helper()
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables/pos-sync", nil, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("pos-sync status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	var sync posTableSyncBody
	decodeTableJSON(t, rec.Body.Bytes(), &sync)

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/claim", nil, pluginHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("claim status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var claim struct {
		SyncID string `json:"syncId"`
	}
	decodeTableJSON(t, rec.Body.Bytes(), &claim)
	if claim.SyncID != sync.ID {
		t.Fatalf("claimed sync id = %q, want %q", claim.SyncID, sync.ID)
	}

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/"+claim.SyncID+"/complete", []byte(body), pluginHeaders())
	if rec.Code != http.StatusNoContent {
		t.Fatalf("complete status = %d, want %d, body = %s", rec.Code, http.StatusNoContent, rec.Body.String())
	}
}

func TestRouter_AdminTables_ReturnsQrTablesWithSignatureAndLinkState(t *testing.T) {
	handler := tableLinkServer(t)
	cfg := tableLinkConfig()

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var body adminTablesBody
	decodeTableJSON(t, rec.Body.Bytes(), &body)

	for _, key := range []string{`"posOnlyTables"`, `"lastSyncedAt"`, `"pendingSync"`, `"posTableId"`, `"posTableTitle"`, `"hallName"`, `"linkedAt"`} {
		if !strings.Contains(rec.Body.String(), key) {
			t.Fatalf("response is missing %s: %s", key, rec.Body.String())
		}
	}

	wantIDs := []string{
		"B-01", "B-02", "B-03", "B-04", "B-05",
		"T-01", "T-02", "T-03", "T-04", "T-05",
		"T-06", "T-07", "T-08", "T-09", "T-10",
	}
	if len(body.Tables) != len(wantIDs) {
		t.Fatalf("got %d tables, want %d", len(body.Tables), len(wantIDs))
	}
	for i, wantID := range wantIDs {
		got := body.Tables[i]
		if got.ID != wantID {
			t.Fatalf("tables[%d].id = %q, want %q", i, got.ID, wantID)
		}
		wantURL := cfg.CustomerWebBaseURL + "/qr/enter?table=" + wantID + "&sig=" + expectedQrSignature(cfg.QRSigningSecret, wantID)
		if got.QrURL != wantURL {
			t.Errorf("tables[%d].qrUrl = %q, want %q", i, got.QrURL, wantURL)
		}
		if got.POSTableID != nil || got.POSTableTitle != nil || got.HallName != nil || got.LinkedAt != nil {
			t.Errorf("tables[%d] = %+v, want no link", i, got)
		}
	}
	if len(body.POSOnlyTables) != 0 {
		t.Errorf("posOnlyTables = %+v, want empty", body.POSOnlyTables)
	}
	if body.LastSyncedAt != nil {
		t.Errorf("lastSyncedAt = %v, want null", *body.LastSyncedAt)
	}
	if body.PendingSync != nil {
		t.Errorf("pendingSync = %+v, want null", body.PendingSync)
	}
}

func TestRouter_AdminTables_ReflectsPOSSnapshotAndAutoLinks(t *testing.T) {
	handler := tableLinkServer(t)

	completePluginSnapshot(t, handler, `{
		"halls": [{"id": 1, "name": "1층"}],
		"tables": [
			{"id": 101, "title": "테이블 1", "hallId": 1, "capacity": 4},
			{"id": 102, "title": "바3", "hallId": 1, "capacity": null},
			{"id": 103, "title": "룸 A", "hallId": null, "capacity": 6}
		]
	}`)

	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var body adminTablesBody
	decodeTableJSON(t, rec.Body.Bytes(), &body)

	var linked int
	for _, table := range body.Tables {
		if table.POSTableID == nil {
			continue
		}
		linked++
		switch table.ID {
		case "T-01":
			if *table.POSTableID != 101 || table.POSTableTitle == nil || *table.POSTableTitle != "테이블 1" {
				t.Errorf("T-01 = %+v, want POS table 101", table)
			}
			if table.HallName == nil || *table.HallName != "1층" {
				t.Errorf("T-01 hallName = %v, want the hall name", table.HallName)
			}
			if table.LinkedAt == nil {
				t.Error("T-01 linkedAt = null, want a timestamp")
			}
		case "B-03":
			if *table.POSTableID != 102 {
				t.Errorf("B-03 = %+v, want POS table 102", table)
			}
		default:
			t.Errorf("unexpected linked table %+v", table)
		}
	}
	if linked != 2 {
		t.Errorf("linked tables = %d, want 2", linked)
	}

	if len(body.POSOnlyTables) != 1 || body.POSOnlyTables[0].POSTableID != 103 {
		t.Fatalf("posOnlyTables = %+v, want only POS table 103", body.POSOnlyTables)
	}
	if body.POSOnlyTables[0].QrTableID != nil {
		t.Errorf("posOnlyTables[0].qrTableId = %v, want null", body.POSOnlyTables[0].QrTableID)
	}
	if body.POSOnlyTables[0].Capacity == nil || *body.POSOnlyTables[0].Capacity != 6 {
		t.Errorf("posOnlyTables[0].capacity = %v, want 6", body.POSOnlyTables[0].Capacity)
	}
	if body.LastSyncedAt == nil {
		t.Error("lastSyncedAt = null, want the snapshot time")
	}
	if body.PendingSync != nil {
		t.Errorf("pendingSync = %+v, want null", body.PendingSync)
	}
}

func TestRouter_AdminTablesPOSSync_ReturnsTheSamePendingRequest(t *testing.T) {
	handler := tableLinkServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables/pos-sync", nil, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	var first posTableSyncBody
	decodeTableJSON(t, rec.Body.Bytes(), &first)
	if first.Status != "PENDING" || first.ID == "" {
		t.Fatalf("first = %+v, want a pending request", first)
	}

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables/pos-sync", nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("second status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var second posTableSyncBody
	decodeTableJSON(t, rec.Body.Bytes(), &second)
	if second.ID != first.ID {
		t.Fatalf("second id = %q, want %q", second.ID, first.ID)
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables", nil, adminHeaders())
	var listed adminTablesBody
	decodeTableJSON(t, rec.Body.Bytes(), &listed)
	if listed.PendingSync == nil || listed.PendingSync.ID != first.ID {
		t.Fatalf("pendingSync = %+v, want the pending request", listed.PendingSync)
	}
}

func TestRouter_AdminTablesPOSSync_TimesOutAfterThirtySeconds(t *testing.T) {
	handler := tableLinkServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables/pos-sync", nil, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	var created posTableSyncBody
	decodeTableJSON(t, rec.Body.Bytes(), &created)

	if _, err := testPool.Exec(context.Background(),
		`UPDATE pos_table_sync_requests SET requested_at = NOW() - INTERVAL '31 seconds' WHERE id = $1`, created.ID); err != nil {
		t.Fatalf("age request: %v", err)
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables/pos-sync/"+created.ID, nil, adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var polled posTableSyncBody
	decodeTableJSON(t, rec.Body.Bytes(), &polled)
	if polled.Status != "TIMED_OUT" {
		t.Fatalf("status = %q, want TIMED_OUT", polled.Status)
	}
	if polled.Error == nil || *polled.Error == "" {
		t.Fatal("error = null, want a timeout message")
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables", nil, adminHeaders())
	var listed adminTablesBody
	decodeTableJSON(t, rec.Body.Bytes(), &listed)
	if listed.PendingSync != nil {
		t.Fatalf("pendingSync = %+v, want null after the timeout", listed.PendingSync)
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables/pos-sync/no-such-id", nil, adminHeaders())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown sync status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestRouter_AdminTablesPOSLink_LinksUnlinksAndReportsConflicts(t *testing.T) {
	handler := tableLinkServer(t)
	// "테이블 7" converts, so the sync creates T-07 itself; 룸 A and 테라스
	// follow no rule and stay POS-only for an operator to link by hand.
	completePluginSnapshot(t, handler, `{"halls": [], "tables": [{"id": 207, "title": "테이블 7"}, {"id": 208, "title": "테이블 8"}, {"id": 201, "title": "룸 A"}, {"id": 202, "title": "테라스"}]}`)

	// 동기화가 T-07을 테이블 7에 묶어 두었으니 먼저 풀고 룸 A로 옮긴다.
	rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/T-07/pos-link", []byte(`{"posTableId": null}`), adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("unlink status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/T-07/pos-link", []byte(`{"posTableId": 201}`), adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var table qrTableBody
	decodeTableJSON(t, rec.Body.Bytes(), &table)
	if table.ID != "T-07" || table.POSTableID == nil || *table.POSTableID != 201 {
		t.Fatalf("table = %+v, want T-07 linked to 201", table)
	}
	if table.QrURL == "" {
		t.Error("qrUrl is empty")
	}

	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/T-08/pos-link", []byte(`{"posTableId": 201}`), adminHeaders())
	if rec.Code != http.StatusConflict {
		t.Fatalf("conflict status = %d, want %d, body = %s", rec.Code, http.StatusConflict, rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/T-08/pos-link", []byte(`{"posTableId": 999}`), adminHeaders())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown POS table status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/Z-99/pos-link", []byte(`{"posTableId": 202}`), adminHeaders())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown QR table status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/T-07/pos-link", []byte(`{"posTableId": null}`), adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("unlink status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	decodeTableJSON(t, rec.Body.Bytes(), &table)
	if table.POSTableID != nil || table.LinkedAt != nil {
		t.Fatalf("table = %+v, want no link", table)
	}
}

func TestRouter_AdminTablesCreate_GeneratesIDAndValidates(t *testing.T) {
	handler := tableLinkServer(t)
	cfg := tableLinkConfig()
	completePluginSnapshot(t, handler, `{"halls": [{"id": 9, "name": "2층"}], "tables": [
		{"id": 301, "title": "테이블 11", "hallId": 9},
		{"id": 302, "title": "룸 A", "hallId": 9},
		{"id": 303, "title": "테라스", "hallId": 9}
	]}`)

	// The POS owns which tables exist, so the sync already created T-11 for
	// the one name that converts. Only the names that follow no rule are left
	// for an operator to name.
	rec := doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables", nil, adminHeaders())
	var afterSync adminTablesBody
	decodeTableJSON(t, rec.Body.Bytes(), &afterSync)
	if len(afterSync.Tables) != 1 || afterSync.Tables[0].ID != "T-11" {
		t.Fatalf("tables = %+v, want just the auto-created T-11", afterSync.Tables)
	}
	if afterSync.Tables[0].POSTableID == nil || *afterSync.Tables[0].POSTableID != 301 {
		t.Fatalf("T-11 pos table = %v, want 301", afterSync.Tables[0].POSTableID)
	}
	if len(afterSync.POSOnlyTables) != 2 {
		t.Fatalf("posOnlyTables = %+v, want 룸 A and 테라스", afterSync.POSOnlyTables)
	}

	// A POS name that follows none of the rules needs an operator-chosen id.
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables", []byte(`{"posTableId": 302}`), adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("auto id status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables", []byte(`{"posTableId": 302, "id": "R-01"}`), adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("explicit id status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	var created qrTableBody
	decodeTableJSON(t, rec.Body.Bytes(), &created)
	if created.ID != "R-01" || created.Area != "R" || created.Number != 1 {
		t.Fatalf("created = %+v, want R-01", created)
	}
	wantURL := cfg.CustomerWebBaseURL + "/qr/enter?table=R-01&sig=" + expectedQrSignature(cfg.QRSigningSecret, "R-01")
	if created.QrURL != wantURL {
		t.Errorf("qrUrl = %q, want %q", created.QrURL, wantURL)
	}

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables", []byte(`{"posTableId": 303, "id": "r-1"}`), adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad id status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables", []byte(`{"posTableId": 303, "id": "T-11"}`), adminHeaders())
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate id status = %d, want %d, body = %s", rec.Code, http.StatusConflict, rec.Body.String())
	}
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables", []byte(`{"posTableId": 301, "id": "T-12"}`), adminHeaders())
	if rec.Code != http.StatusConflict {
		t.Fatalf("already linked POS table status = %d, want %d, body = %s", rec.Code, http.StatusConflict, rec.Body.String())
	}
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables", []byte(`{"posTableId": 0}`), adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing posTableId status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestRouter_TableLinkEndpoints_RequireTheirOwnToken(t *testing.T) {
	handler := tableLinkServer(t)

	adminPaths := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/admin/tables"},
		{http.MethodPost, "/api/v1/admin/tables"},
		{http.MethodPost, "/api/v1/admin/tables/pos-sync"},
		{http.MethodGet, "/api/v1/admin/tables/pos-sync/any"},
		{http.MethodPatch, "/api/v1/admin/tables/T-01/pos-link"},
	}
	for _, tc := range adminPaths {
		rec := doRequest(t, handler, tc.method, tc.path, []byte(`{}`), nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s status = %d, want %d", tc.method, tc.path, rec.Code, http.StatusUnauthorized)
		}
		rec = doRequest(t, handler, tc.method, tc.path, []byte(`{}`), pluginHeaders())
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s with the plugin token status = %d, want %d", tc.method, tc.path, rec.Code, http.StatusUnauthorized)
		}
	}

	pluginPaths := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/pos-plugin/tables/claim"},
		{http.MethodPost, "/api/v1/pos-plugin/tables/any/complete"},
		{http.MethodPost, "/api/v1/pos-plugin/tables/any/fail"},
		{http.MethodGet, "/api/v1/pos-plugin/table-mappings"},
	}
	for _, tc := range pluginPaths {
		rec := doRequest(t, handler, tc.method, tc.path, []byte(`{}`), nil)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s status = %d, want %d", tc.method, tc.path, rec.Code, http.StatusUnauthorized)
		}
		rec = doRequest(t, handler, tc.method, tc.path, []byte(`{}`), adminHeaders())
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s with the admin token status = %d, want %d", tc.method, tc.path, rec.Code, http.StatusUnauthorized)
		}
	}
}

func TestRouter_POSPluginTables_ClaimCompleteFailAndMappings(t *testing.T) {
	handler := tableLinkServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/claim", nil, pluginHeaders())
	if rec.Code != http.StatusNoContent {
		t.Fatalf("idle claim status = %d, want %d, body = %s", rec.Code, http.StatusNoContent, rec.Body.String())
	}

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/pos-plugin/table-mappings", nil, pluginHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("mappings status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var empty struct {
		Mappings  map[string]int64 `json:"mappings"`
		UpdatedAt *string          `json:"updatedAt"`
	}
	decodeTableJSON(t, rec.Body.Bytes(), &empty)
	if len(empty.Mappings) != 0 || empty.UpdatedAt != nil {
		t.Fatalf("mappings = %+v, want empty", empty)
	}

	completePluginSnapshot(t, handler, `{"halls": [], "tables": [{"id": 401, "title": "테이블 2"}]}`)

	rec = doRequest(t, handler, http.MethodGet, "/api/v1/pos-plugin/table-mappings", nil, pluginHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("mappings status = %d, want %d, body = %s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var mappings struct {
		Mappings  map[string]int64 `json:"mappings"`
		UpdatedAt *string          `json:"updatedAt"`
	}
	decodeTableJSON(t, rec.Body.Bytes(), &mappings)
	if len(mappings.Mappings) != 1 || mappings.Mappings["T-02"] != 401 {
		t.Fatalf("mappings = %+v, want a single T-02 entry", mappings.Mappings)
	}
	if mappings.UpdatedAt == nil {
		t.Fatal("updatedAt = null, want the last link time")
	}

	// A failed sync records the plugin's reason.
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables/pos-sync", nil, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("pos-sync status = %d, want %d", rec.Code, http.StatusCreated)
	}
	var pending posTableSyncBody
	decodeTableJSON(t, rec.Body.Bytes(), &pending)
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/claim", nil, pluginHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("claim status = %d, want %d", rec.Code, http.StatusOK)
	}
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/"+pending.ID+"/fail",
		[]byte(`{"error": "POS 테이블 목록을 읽지 못했습니다"}`), pluginHeaders())
	if rec.Code != http.StatusNoContent {
		t.Fatalf("fail status = %d, want %d, body = %s", rec.Code, http.StatusNoContent, rec.Body.String())
	}
	rec = doRequest(t, handler, http.MethodGet, "/api/v1/admin/tables/pos-sync/"+pending.ID, nil, adminHeaders())
	var failed posTableSyncBody
	decodeTableJSON(t, rec.Body.Bytes(), &failed)
	if failed.Status != "FAILED" || failed.Error == nil || *failed.Error != "POS 테이블 목록을 읽지 못했습니다" {
		t.Fatalf("failed = %+v, want the reported failure", failed)
	}

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/no-such-sync/complete",
		[]byte(`{"halls": [], "tables": []}`), pluginHeaders())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown sync complete status = %d, want %d, body = %s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestRouter_POSPluginTablesComplete_RejectsOversizedSnapshot(t *testing.T) {
	handler := tableLinkServer(t)

	rec := doRequest(t, handler, http.MethodPost, "/api/v1/admin/tables/pos-sync", nil, adminHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("pos-sync status = %d, want %d", rec.Code, http.StatusCreated)
	}
	var pending posTableSyncBody
	decodeTableJSON(t, rec.Body.Bytes(), &pending)
	if rec = doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/claim", nil, pluginHeaders()); rec.Code != http.StatusOK {
		t.Fatalf("claim status = %d, want %d", rec.Code, http.StatusOK)
	}

	entries := make([]string, 0, 301)
	for i := 1; i <= 301; i++ {
		entries = append(entries, fmt.Sprintf(`{"id": %d, "title": "룸 %d"}`, i, i))
	}
	body := `{"halls": [], "tables": [` + strings.Join(entries, ",") + `]}`

	rec = doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/"+pending.ID+"/complete", []byte(body), pluginHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	// A body past the 1MiB cap is rejected too, not silently truncated.
	padding := strings.Repeat("가", 400000)
	rec = doRequest(t, handler, http.MethodPost, "/api/v1/pos-plugin/tables/"+pending.ID+"/complete",
		[]byte(`{"halls": [], "tables": [{"id": 1, "title": "`+padding+`"}]}`), pluginHeaders())
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body status = %d, want 400 or 413, body = %s", rec.Code, rec.Body.String())
	}
}

func seedOrderableMenuItemViaSQL(t *testing.T) string {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `
		INSERT INTO menu_categories (id, label, is_visible, sort_order) VALUES ('highball', '하이볼', TRUE, 1);
		INSERT INTO menu_items (id, toss_catalog_item_id, category_id, name, description, price, is_visible, sort_order)
		VALUES ('earlgrey', '7001', 'highball', '얼그레이 하이볼', '설명', '11,000원', TRUE, 1);
	`); err != nil {
		t.Fatalf("seed menu: %v", err)
	}
	return "earlgrey"
}

func TestRouter_CreateOrder_BlocksUnlinkedTableOnlyWhenLinksExist(t *testing.T) {
	handler := tableLinkServer(t)
	menuItemID := seedOrderableMenuItemViaSQL(t)
	headers := map[string]string{"Authorization": "Bearer " + testCfg.PaymentAPIToken}

	orderBody := func(tableNumber string) []byte {
		return []byte(fmt.Sprintf(`{"menuItemId": %q, "tableNumber": %q}`, menuItemID, tableNumber))
	}

	for _, path := range []string{"/api/v1/orders", "/api/v1/payments/orders"} {
		rec := doRequest(t, handler, http.MethodPost, path, orderBody("T-02"), headers)
		if rec.Code != http.StatusCreated {
			t.Fatalf("%s with no links status = %d, want %d, body = %s", path, rec.Code, http.StatusCreated, rec.Body.String())
		}
	}

	completePluginSnapshot(t, handler, `{"halls": [], "tables": [{"id": 501, "title": "테이블 1"}]}`)

	for _, path := range []string{"/api/v1/orders", "/api/v1/payments/orders"} {
		rec := doRequest(t, handler, http.MethodPost, path, orderBody("T-01"), headers)
		if rec.Code != http.StatusCreated {
			t.Fatalf("%s for the linked table status = %d, want %d, body = %s", path, rec.Code, http.StatusCreated, rec.Body.String())
		}

		rec = doRequest(t, handler, http.MethodPost, path, orderBody("T-02"), headers)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s for an unlinked table status = %d, want %d, body = %s", path, rec.Code, http.StatusBadRequest, rec.Body.String())
		}
		var blocked struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		decodeTableJSON(t, rec.Body.Bytes(), &blocked)
		if blocked.Code != "table_not_linked" || blocked.Error != "table is not linked to POS" {
			t.Fatalf("%s blocked body = %+v, want the table_not_linked contract", path, blocked)
		}
	}

	// Customer requests must keep working for an unlinked table.
	rec := doRequest(t, handler, http.MethodPost, "/api/v1/customer-requests",
		[]byte(`{"tableNumber": "T-02", "text": "물 주세요"}`), requestHeaders())
	if rec.Code != http.StatusCreated {
		t.Fatalf("customer request status = %d, want %d, body = %s", rec.Code, http.StatusCreated, rec.Body.String())
	}
}

// An operator corrects a QR table's own code through the admin API; the POS
// link it already carries must survive, and the QR URL must be re-signed for
// the new code.
func TestRouter_AdminTables_RenamesQrTableCode(t *testing.T) {
	handler := tableLinkServer(t)
	cfg := tableLinkConfig()
	// The sync names this one B-06 after "바6". The operator knows the table
	// actually sits in the room area and corrects the code.
	completePluginSnapshot(t, handler, `{"halls":[{"id":1,"name":"1층 홀"}],"tables":[{"id":501,"title":"바6","hallId":1,"capacity":2},{"id":502,"title":"테이블 1","hallId":1}]}`)

	rec := doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/B-06/code", []byte(`{"id":"R-02"}`), adminHeaders())
	if rec.Code != http.StatusOK {
		t.Fatalf("rename status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var renamed qrTableBody
	decodeTableJSON(t, rec.Body.Bytes(), &renamed)
	if renamed.ID != "R-02" || renamed.Area != "R" || renamed.Number != 2 {
		t.Fatalf("renamed = %+v, want R-02", renamed)
	}
	if renamed.POSTableID == nil || *renamed.POSTableID != 501 {
		t.Fatalf("posTableId = %v, want the link to survive the rename", renamed.POSTableID)
	}
	wantURL := cfg.CustomerWebBaseURL + "/qr/enter?table=R-02&sig=" + expectedQrSignature(cfg.QRSigningSecret, "R-02")
	if renamed.QrURL != wantURL {
		t.Fatalf("qrUrl = %q, want %q", renamed.QrURL, wantURL)
	}

	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/R-02/code", []byte(`{"id":"T-01"}`), adminHeaders())
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate rename status = %d, want 409, body = %s", rec.Code, rec.Body.String())
	}
	rec = doRequest(t, handler, http.MethodPatch, "/api/v1/admin/tables/R-02/code", []byte(`{"id":"b6"}`), adminHeaders())
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed rename status = %d, want 400, body = %s", rec.Code, rec.Body.String())
	}
}
