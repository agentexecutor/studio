// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package ux holds the AX Studio web UI: plain HTML, CSS and JavaScript that
// the browser loads as they are. There is no build step, so the files in this
// directory are the ones the Studio server sends.
package ux

import "embed"

// FS holds the UI: the page, its scripts and stylesheets, and its images.
// The tests in tests/ and the README are not part of it.
//
//go:embed index.html *.js *.css assets
var FS embed.FS
