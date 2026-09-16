package store

import (
	"context"
	"testing"
	"time"

	"github.com/her9797/laam/laam-api/internal/lamdata"
)

// idSpacingDelay separates same-millisecond CreateCustomerRequest/
// CreateSpecialRequest calls: both derive their row id from
// time.Now().UnixMilli(), so two calls landing in the same millisecond
// collide on the primary key and the second INSERT fails with
// ErrAlreadyExists. This reliably reproduced on GitHub Actions' faster
// runners (though not locally) for every test below that creates more than
// one row in a tight loop.
const idSpacingDelay = 2 * time.Millisecond

func createCustomerRequestsForListing(t *testing.T, repo *Repository, ctx context.Context) {
	t.Helper()

	seed := []struct {
		table  string
		text   string
		status string
	}{
		{"T-01", "napkins please", "pending"},
		{"T-02", "[노래 신청] Dynamite", "pending"},
		{"T-03", "check please", "checked"},
		{"T-04", "[노래 신청] Butter", "completed"},
		{"T-05", "more ice", "completed"},
	}

	for _, s := range seed {
		if err := repo.CreateCustomerRequest(ctx, s.table, s.text); err != nil {
			t.Fatalf("CreateCustomerRequest(%q) error = %v", s.table, err)
		}
		time.Sleep(idSpacingDelay)
	}

	all, err := repo.ListCustomerRequests(ctx)
	if err != nil {
		t.Fatalf("ListCustomerRequests() error = %v", err)
	}
	byTable := make(map[string]string, len(all))
	for _, r := range all {
		byTable[r.TableNumber] = r.ID
	}
	for _, s := range seed {
		if s.status == "pending" {
			continue
		}
		id, ok := byTable[s.table]
		if !ok {
			t.Fatalf("seed request for table %q not found after create", s.table)
		}
		if err := repo.UpdateCustomerRequestStatus(ctx, id, s.status); err != nil {
			t.Fatalf("UpdateCustomerRequestStatus(%q, %q) error = %v", id, s.status, err)
		}
	}
}

func TestRepository_ListCustomerRequestsPage_FiltersByStatus(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createCustomerRequestsForListing(t, repo, ctx)

	items, total, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
		Status: "pending", Kind: "all", Sort: "status", Order: "asc",
		Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListCustomerRequestsPage() error = %v", err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	for _, item := range items {
		if item.Status != "pending" {
			t.Errorf("item.Status = %q, want pending", item.Status)
		}
	}
}

func TestRepository_ListCustomerRequestsPage_FiltersByKind(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createCustomerRequestsForListing(t, repo, ctx)

	t.Run("song only", func(t *testing.T) {
		items, total, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
			Kind: "song", Sort: "createdAt", Order: "desc", Page: 1, PageSize: 20,
		})
		if err != nil {
			t.Fatalf("ListCustomerRequestsPage() error = %v", err)
		}
		if total != 2 {
			t.Fatalf("total = %d, want 2", total)
		}
		for _, item := range items {
			if item.TableNumber != "T-02" && item.TableNumber != "T-04" {
				t.Errorf("unexpected non-song item in kind=song result: %+v", item)
			}
		}
	})

	t.Run("general excludes song", func(t *testing.T) {
		items, total, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
			Kind: "general", Sort: "createdAt", Order: "desc", Page: 1, PageSize: 20,
		})
		if err != nil {
			t.Fatalf("ListCustomerRequestsPage() error = %v", err)
		}
		if total != 3 {
			t.Fatalf("total = %d, want 3", total)
		}
		for _, item := range items {
			if item.TableNumber == "T-02" || item.TableNumber == "T-04" {
				t.Errorf("song item leaked into kind=general result: %+v", item)
			}
		}
	})
}

func TestRepository_ListCustomerRequestsPage_SearchMatchesTextAndTableNumber(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createCustomerRequestsForListing(t, repo, ctx)

	items, total, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
		Kind: "all", Search: "T-03", Sort: "createdAt", Order: "desc", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListCustomerRequestsPage() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(items) != 1 || items[0].TableNumber != "T-03" {
		t.Fatalf("items = %+v, want a single T-03 match", items)
	}
}

func TestRepository_ListCustomerRequestsPage_SearchEscapesLikeWildcards(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCustomerRequest(ctx, "T-99", "50% off please"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}
	time.Sleep(idSpacingDelay)
	if err := repo.CreateCustomerRequest(ctx, "T-98", "50 percent unrelated"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}

	items, total, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
		Kind: "all", Search: "50%", Sort: "createdAt", Order: "desc", Page: 1, PageSize: 20,
	})
	if err != nil {
		t.Fatalf("ListCustomerRequestsPage() error = %v", err)
	}
	if total != 1 || len(items) != 1 || items[0].TableNumber != "T-99" {
		t.Fatalf("items = %+v (total=%d), want exactly the literal 50%% match", items, total)
	}
}

func TestRepository_ListCustomerRequestsPage_PagesAndCounts(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()
	createCustomerRequestsForListing(t, repo, ctx)

	page1, total, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
		Kind: "all", Sort: "tableNumber", Order: "asc", Page: 1, PageSize: 2,
	})
	if err != nil {
		t.Fatalf("ListCustomerRequestsPage() page 1 error = %v", err)
	}
	if total != 5 {
		t.Fatalf("total = %d, want 5", total)
	}
	if len(page1) != 2 || page1[0].TableNumber != "T-01" || page1[1].TableNumber != "T-02" {
		t.Fatalf("page1 = %+v, want [T-01, T-02]", page1)
	}

	page2, _, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
		Kind: "all", Sort: "tableNumber", Order: "asc", Page: 2, PageSize: 2,
	})
	if err != nil {
		t.Fatalf("ListCustomerRequestsPage() page 2 error = %v", err)
	}
	if len(page2) != 2 || page2[0].TableNumber != "T-03" || page2[1].TableNumber != "T-04" {
		t.Fatalf("page2 = %+v, want [T-03, T-04]", page2)
	}
}

func TestRepository_ListSpecialRequestsPage_FiltersSearchesSortsAndPages(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	seed := []lamdata.SpecialRequest{
		{TableNumber: "T-01", Gender: "male", Name: "Kim", Age: "20s", Residence: "Seoul", Instagram: "@kim", IdealType: "tall", Text: "hi"},
		{TableNumber: "T-02", Gender: "female", Name: "Lee", Age: "30s", Residence: "Busan", Instagram: "@lee", IdealType: "kind", Text: "hello"},
		{TableNumber: "T-03", Gender: "female", Name: "Park", Age: "20s", Residence: "Seoul", Instagram: "@park", IdealType: "funny", Text: "hey"},
	}
	for _, s := range seed {
		if err := repo.CreateSpecialRequest(ctx, s); err != nil {
			t.Fatalf("CreateSpecialRequest(%q) error = %v", s.Name, err)
		}
		time.Sleep(idSpacingDelay)
	}

	t.Run("filters by gender", func(t *testing.T) {
		items, total, err := repo.ListSpecialRequestsPage(ctx, SpecialRequestFilter{
			Gender: "female", Sort: "name", Order: "asc", Page: 1, PageSize: 20,
		})
		if err != nil {
			t.Fatalf("ListSpecialRequestsPage() error = %v", err)
		}
		if total != 2 {
			t.Fatalf("total = %d, want 2", total)
		}
		if len(items) != 2 || items[0].Name != "Lee" || items[1].Name != "Park" {
			t.Fatalf("items = %+v, want [Lee, Park] ordered by name asc", items)
		}
	})

	t.Run("search matches residence", func(t *testing.T) {
		items, total, err := repo.ListSpecialRequestsPage(ctx, SpecialRequestFilter{
			Search: "Seoul", Sort: "createdAt", Order: "desc", Page: 1, PageSize: 20,
		})
		if err != nil {
			t.Fatalf("ListSpecialRequestsPage() error = %v", err)
		}
		if total != 2 {
			t.Fatalf("total = %d, want 2", total)
		}
		for _, item := range items {
			if item.Residence != "Seoul" {
				t.Errorf("unexpected non-Seoul item: %+v", item)
			}
		}
	})

	t.Run("pages results", func(t *testing.T) {
		page1, total, err := repo.ListSpecialRequestsPage(ctx, SpecialRequestFilter{
			Sort: "name", Order: "asc", Page: 1, PageSize: 2,
		})
		if err != nil {
			t.Fatalf("ListSpecialRequestsPage() page 1 error = %v", err)
		}
		if total != 3 {
			t.Fatalf("total = %d, want 3", total)
		}
		if len(page1) != 2 || page1[0].Name != "Kim" || page1[1].Name != "Lee" {
			t.Fatalf("page1 = %+v, want [Kim, Lee]", page1)
		}
	})
}

func TestRepository_ListCustomerRequestsPage_InvalidSortIsRejected(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if _, _, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
		Kind: "all", Sort: "id", Order: "asc", Page: 1, PageSize: 20,
	}); err == nil {
		t.Error("ListCustomerRequestsPage(invalid sort) error = nil, want an error")
	}
}

func TestRepository_ListCustomerRequestsPage_FiltersByCreatedAtRange(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	if err := repo.CreateCustomerRequest(ctx, "T-01", "before range"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}
	time.Sleep(idSpacingDelay)

	from := time.Now()
	time.Sleep(idSpacingDelay)
	if err := repo.CreateCustomerRequest(ctx, "T-02", "inside range"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}
	time.Sleep(idSpacingDelay)
	to := time.Now()
	time.Sleep(idSpacingDelay)

	if err := repo.CreateCustomerRequest(ctx, "T-03", "after range"); err != nil {
		t.Fatalf("CreateCustomerRequest() error = %v", err)
	}

	items, total, err := repo.ListCustomerRequestsPage(ctx, CustomerRequestFilter{
		Kind: "all", Sort: "createdAt", Order: "asc", Page: 1, PageSize: 20,
		From: &from, To: &to,
	})
	if err != nil {
		t.Fatalf("ListCustomerRequestsPage() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(items) != 1 || items[0].TableNumber != "T-02" {
		t.Fatalf("items = %+v, want just T-02", items)
	}
}

func TestRepository_ListSpecialRequestsPage_FiltersByCreatedAtRange(t *testing.T) {
	repo := resetDB(t)
	ctx := context.Background()

	newSpecialRequest := func(table, name string) lamdata.SpecialRequest {
		return lamdata.SpecialRequest{
			TableNumber: table, Gender: "male", Name: name, Age: "20s",
			Residence: "Seoul", Instagram: "@" + name, IdealType: "tall", Text: "hi",
		}
	}

	if err := repo.CreateSpecialRequest(ctx, newSpecialRequest("T-01", "Before")); err != nil {
		t.Fatalf("CreateSpecialRequest() error = %v", err)
	}
	time.Sleep(idSpacingDelay)

	from := time.Now()
	time.Sleep(idSpacingDelay)
	if err := repo.CreateSpecialRequest(ctx, newSpecialRequest("T-02", "Inside")); err != nil {
		t.Fatalf("CreateSpecialRequest() error = %v", err)
	}
	time.Sleep(idSpacingDelay)
	to := time.Now()
	time.Sleep(idSpacingDelay)

	if err := repo.CreateSpecialRequest(ctx, newSpecialRequest("T-03", "After")); err != nil {
		t.Fatalf("CreateSpecialRequest() error = %v", err)
	}

	items, total, err := repo.ListSpecialRequestsPage(ctx, SpecialRequestFilter{
		Sort: "createdAt", Order: "asc", Page: 1, PageSize: 20,
		From: &from, To: &to,
	})
	if err != nil {
		t.Fatalf("ListSpecialRequestsPage() error = %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if len(items) != 1 || items[0].Name != "Inside" {
		t.Fatalf("items = %+v, want just Inside", items)
	}
}
