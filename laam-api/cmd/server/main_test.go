package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
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
