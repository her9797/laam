package possync

import (
	"testing"

	"github.com/her9797/laam/laam-api/internal/store"
	"github.com/her9797/laam/laam-api/internal/tossplace"
)

func line(title string, category string, price int64, quantity int64, options ...tossplace.OrderLineItemOptionChoice) tossplace.OrderLineItem {
	item := tossplace.OrderLineItem{Quantity: quantity, OptionChoices: options}
	item.Item.Title = title
	item.Item.Category.Title = category
	item.ItemPrice.PriceValue = price
	return item
}

func TestNativeLines_ReturnsOnlyLinesNotAlreadyRecorded(t *testing.T) {
	lines := []tossplace.OrderLineItem{
		line("하우스 하이볼", "하이볼", 10000, 1, tossplace.OrderLineItemOptionChoice{Title: "샷 추가", PriceValue: 1000, Quantity: 1}),
		line("하우스 하이볼", "하이볼", 10000, 1),
		line("생맥주", "맥주", 6000, 2),
	}
	existing := []store.POSOrderLine{
		{MenuItemName: "하우스 하이볼", CategoryName: "하이볼", Amount: 11000},
		{MenuItemName: "하우스 하이볼", CategoryName: "하이볼", Amount: 10000},
	}

	got := NativeLines(lines, existing)
	if len(got) != 1 || got[0].MenuItemName != "생맥주" || got[0].CategoryName != "맥주" || got[0].Amount != 12000 {
		t.Fatalf("NativeLines() = %+v, want only 생맥주 12000", got)
	}
}

func TestNativeLines_MatchesRenamedWebOrderByAmount(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("하이볼(POS명)", "하이볼", 11000, 1)}
	existing := []store.POSOrderLine{{MenuItemName: "하우스 하이볼", CategoryName: "하이볼", Amount: 11000}}

	if got := NativeLines(lines, existing); len(got) != 0 {
		t.Fatalf("NativeLines() = %+v, want none (renamed web order matched by amount)", got)
	}
}

func TestNativeLines_KeepsDuplicatePOSLinesBeyondRecordedCount(t *testing.T) {
	lines := []tossplace.OrderLineItem{
		line("생맥주", "맥주", 6000, 1),
		line("생맥주", "맥주", 6000, 1),
	}
	existing := []store.POSOrderLine{{MenuItemName: "생맥주", CategoryName: "맥주", Amount: 6000}}

	got := NativeLines(lines, existing)
	if len(got) != 1 || got[0].Amount != 6000 {
		t.Fatalf("NativeLines() = %+v, want one remaining 생맥주", got)
	}
}

func TestNativeLines_SkipsNonPositiveAmounts(t *testing.T) {
	lines := []tossplace.OrderLineItem{line("서비스", "기타", 0, 1)}
	if got := NativeLines(lines, nil); len(got) != 0 {
		t.Fatalf("NativeLines() = %+v, want none", got)
	}
}
