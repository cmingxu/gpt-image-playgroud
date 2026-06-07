GO ?= go
BIN ?= app
OUTDIR ?= bin
WEB_DIR ?= web
CGO_ENABLED ?= 0
GOOS ?= linux
GOARCH ?= amd64
DEPLOY_HOST ?= dev
DEPLOY_PATH ?= /usr/local/bin/gpt-image
SERVICE_NAME ?= gpt-image

.PHONY: build build-web dev test vet web-lint web-build deploy

build: build-web
	@mkdir -p $(OUTDIR)
	CGO_ENABLED=$(CGO_ENABLED) GOOS=$(GOOS) GOARCH=$(GOARCH) $(GO) build -tags embed -o $(OUTDIR)/$(BIN) ./cmd/willing

build-web:
	cd $(WEB_DIR) && npm install && npm run build

dev:
	$(GO) run ./cmd/willing serve

test:
	$(GO) test ./...

vet:
	$(GO) vet ./...

web-lint:
	cd $(WEB_DIR) && npm run lint

web-build:
	cd $(WEB_DIR) && npm run build

deploy: build
	@echo "=== Deploying to $(DEPLOY_HOST) ==="
	ssh $(DEPLOY_HOST) 'systemctl stop $(SERVICE_NAME) || true'
	scp $(OUTDIR)/$(BIN) $(DEPLOY_HOST):$(DEPLOY_PATH)
	scp deploy/$(SERVICE_NAME).service $(DEPLOY_HOST):/etc/systemd/system/
	ssh $(DEPLOY_HOST) 'mkdir -p /var/lib/gpt-image/var/db'
	ssh $(DEPLOY_HOST) 'systemctl daemon-reload && systemctl enable $(SERVICE_NAME) && systemctl restart $(SERVICE_NAME)'
	@echo "=== Deploy complete ==="
