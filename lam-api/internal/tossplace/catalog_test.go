package tossplace

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientListCatalogItems(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api-public/openapi/v1/merchants/merchant-123/catalog/items" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.URL.Query().Get("page") != "1" || r.URL.Query().Get("size") != "100" {
			t.Fatalf("query = %s", r.URL.RawQuery)
		}
		if r.Header.Get("x-access-key") != "access" || r.Header.Get("x-secret-key") != "secret" {
			t.Fatal("missing Toss Place authentication headers")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"resultType":"SUCCESS",
			"success":[{
				"id":"item-1",
				"title":"얼그레이하이볼",
				"description":"티 향",
				"imageUrl":"https://cdn.example.com/earlgrey.png",
				"labels":["추천","신규"],
				"category":{"id":"category-1","title":"1%~7%"},
				"price":{"title":"기본","priceType":"FIXED","priceUnit":1,"priceValue":10000},
				"options":[{"id":"option-1","title":"샷","enabled":true,"order":1,"required":false,"minChoices":1,"maxChoices":2,"choices":[{"id":"choice-1","optionId":"option-1","title":"샷 추가","state":"ON_SALE","enabled":true,"order":1,"priceValue":500,"imageUrl":"https://cdn.example.com/shot.png","quantityEnabled":true,"minQuantity":1,"maxQuantity":3}]}],
				"state":"ON_SALE",
				"enabled":true,
				"order":3
			}]
		}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "access", "secret", "merchant-123", server.Client())
	items, err := client.ListCatalogItems(context.Background())
	if err != nil {
		t.Fatalf("ListCatalogItems() error = %v", err)
	}
	if len(items) != 1 || items[0].ID != "item-1" || items[0].Price.Value != 10000 || items[0].Category.Title != "1%~7%" {
		t.Fatalf("items = %+v", items)
	}
	if items[0].ImageURL != "https://cdn.example.com/earlgrey.png" || len(items[0].Labels) != 2 || items[0].Labels[0] != "추천" || len(items[0].Options) != 1 || items[0].Options[0].Choices[0].PriceValue != 500 {
		t.Fatalf("catalog media/options = %+v", items[0])
	}
}
