package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"testing"
	"time"
)

func TestStartTossCatalogSyncDoesNotSchedulePeriodicPolling(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "main.go", nil, 0)
	if err != nil {
		t.Fatalf("parse main.go: %v", err)
	}

	var target *ast.FuncDecl
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if ok && function.Name.Name == "startTossCatalogSync" {
			target = function
			break
		}
	}
	if target == nil {
		t.Fatal("startTossCatalogSync function not found")
	}

	ast.Inspect(target.Body, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		selector, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "NewTicker" {
			return true
		}
		packageName, ok := selector.X.(*ast.Ident)
		if ok && packageName.Name == "time" {
			t.Error("startTossCatalogSync must not schedule periodic catalog polling")
		}
		return true
	})
}

func TestNewHTTPServerSetsConnectionTimeouts(t *testing.T) {
	server := newHTTPServer(":0", http.NotFoundHandler())

	if server.ReadHeaderTimeout != 5*time.Second {
		t.Errorf("ReadHeaderTimeout = %v, want 5s", server.ReadHeaderTimeout)
	}
	// An 8MB admin image upload over a slow link must fit in ReadTimeout.
	if server.ReadTimeout < time.Minute {
		t.Errorf("ReadTimeout = %v, want at least 1m", server.ReadTimeout)
	}
	// WriteTimeout is counted from the end of the request headers, so it must
	// cover the body read plus the manual catalog sync's 30s context.
	if server.WriteTimeout < server.ReadTimeout+30*time.Second {
		t.Errorf("WriteTimeout = %v, want at least ReadTimeout+30s (%v)", server.WriteTimeout, server.ReadTimeout+30*time.Second)
	}
	if server.IdleTimeout <= 0 {
		t.Errorf("IdleTimeout = %v, want a positive limit", server.IdleTimeout)
	}
}
