package httpapi

import "testing"

func TestPOSPluginClaimsEnabled(t *testing.T) {
	if posPluginClaimsEnabled("open-api") {
		t.Fatal("open-api provider must not allow POS plugin claims")
	}
	if !posPluginClaimsEnabled("plugin") {
		t.Fatal("plugin provider must allow POS plugin claims")
	}
}
