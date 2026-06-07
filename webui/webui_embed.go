//go:build embed

package webui

import (
	"embed"
	"io"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed all:dist
var distFS embed.FS

func Register(r *gin.Engine) {
	d, err := fs.Sub(distFS, "dist")
	if err != nil {
		return
	}

	// Serve static files from dist/ at root path
	r.GET("/", func(c *gin.Context) {
		serveFileFromFS(c, d, "index.html", "text/html; charset=utf-8")
	})

	r.GET("/assets/*path", func(c *gin.Context) {
		serveStaticFromFS(c, d, "assets", c.Param("path"))
	})

	r.GET("/models/*path", func(c *gin.Context) {
		serveStaticFromFS(c, d, "models", c.Param("path"))
	})

	r.GET("/ort/*path", func(c *gin.Context) {
		serveStaticFromFS(c, d, "ort", c.Param("path"))
	})

	r.GET("/demo.png", func(c *gin.Context) {
		serveFileFromFS(c, d, "demo.png", "image/png")
	})
	r.GET("/favicon.svg", func(c *gin.Context) {
		serveFileFromFS(c, d, "favicon.svg", "image/svg+xml")
	})
	r.GET("/icons.svg", func(c *gin.Context) {
		serveFileFromFS(c, d, "icons.svg", "image/svg+xml")
	})

	r.NoRoute(func(c *gin.Context) {
		p := c.Request.URL.Path
		if strings.HasPrefix(p, "/api/") {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		serveFileFromFS(c, d, "index.html", "text/html; charset=utf-8")
	})
}

func serveStaticFromFS(c *gin.Context, dist fs.FS, prefix, p string) {
	p = strings.TrimPrefix(p, "/")
	if p == "" {
		c.Status(http.StatusNotFound)
		return
	}
	filePath := prefix + "/" + p
	if info, err := fs.Stat(dist, filePath); err == nil && !info.IsDir() {
		c.FileFromFS(filePath, http.FS(dist))
		return
	}
	c.Status(http.StatusNotFound)
}

func serveFileFromFS(c *gin.Context, dist fs.FS, filePath, contentType string) {
	f, err := dist.Open(filePath)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer f.Close()
	b, _ := io.ReadAll(f)
	c.Header("Content-Type", contentType)
	c.Data(http.StatusOK, contentType, b)
}
