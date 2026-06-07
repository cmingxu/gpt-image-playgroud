//go:build !embed

package webui

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

func Register(r *gin.Engine) {
	distDir := filepath.Join("webui", "dist")
	indexPath := filepath.Join(distDir, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return
	}

	r.GET("/", func(c *gin.Context) {
		serveFile(c, indexPath, "text/html; charset=utf-8")
	})

	r.GET("/assets/*path", func(c *gin.Context) {
		serveStatic(c, distDir, "assets", c.Param("path"))
	})

	r.GET("/models/*path", func(c *gin.Context) {
		serveStatic(c, distDir, "models", c.Param("path"))
	})

	r.GET("/ort/*path", func(c *gin.Context) {
		serveStatic(c, distDir, "ort", c.Param("path"))
	})

	r.GET("/demo.png", func(c *gin.Context) {
		serveFile(c, filepath.Join(distDir, "demo.png"), "image/png")
	})
	r.GET("/favicon.svg", func(c *gin.Context) {
		serveFile(c, filepath.Join(distDir, "favicon.svg"), "image/svg+xml")
	})
	r.GET("/icons.svg", func(c *gin.Context) {
		serveFile(c, filepath.Join(distDir, "icons.svg"), "image/svg+xml")
	})

	r.NoRoute(func(c *gin.Context) {
		p := c.Request.URL.Path
		if strings.HasPrefix(p, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		serveFile(c, indexPath, "text/html; charset=utf-8")
	})
}

func serveStatic(c *gin.Context, distDir, prefix, p string) {
	p = strings.TrimPrefix(p, "/")
	if p == "" {
		c.Status(http.StatusNotFound)
		return
	}
	c.FileFromFS(filepath.Join(prefix, p), http.Dir(distDir))
}

func serveFile(c *gin.Context, filePath, contentType string) {
	b, err := os.ReadFile(filePath)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Content-Type", contentType)
	c.Data(http.StatusOK, contentType, b)
}
