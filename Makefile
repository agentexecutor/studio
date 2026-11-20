# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

GOTOOLCHAIN ?= auto
export GOTOOLCHAIN

VERSION ?= dev
BINARY ?= bin/ax-studio
PLATFORMS ?= linux/amd64 linux/arm64 darwin/amd64 darwin/arm64

.PHONY: all build dist test verify clean

all: build

build:
	mkdir -p bin
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o $(BINARY) ./cmd/ax-studio

dist:
	rm -rf dist
	mkdir -p dist
	@set -e; for platform in $(PLATFORMS); do \
		os=$${platform%/*}; \
		arch=$${platform#*/}; \
		stage="dist/stage-$${os}-$${arch}"; \
		mkdir -p "$$stage"; \
		echo "==> Building ax-studio ($${os}/$${arch})..."; \
		GOOS=$$os GOARCH=$$arch CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o "$$stage/ax-studio" ./cmd/ax-studio; \
		tar -C "$$stage" -czf "dist/ax-studio_$${os}_$${arch}.tar.gz" ax-studio; \
		rm -rf "$$stage"; \
	done
	cd dist && sha256sum ax-studio_*.tar.gz > checksums.txt

test:
	@set -e; for suite in ux/tests/smoke_*.cjs; do echo "==> node $$suite"; node "$$suite" > /dev/null || { node "$$suite" | tail -n 20; exit 1; }; done
	go test -race -count=1 ./...

verify: test
	gofmt -s -w .
	go vet ./...

clean:
	rm -rf bin dist
