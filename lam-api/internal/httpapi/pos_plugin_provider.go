package httpapi

func posPluginClaimsEnabled(provider string) bool {
	return provider == "plugin"
}
