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

package studio

import (
	"os"
	"strings"
)

// The images `ax local start` deploys when you don't choose others.
//
// AX doesn't publish release images yet, so its own defaults are empty and
// `ax local start` stops without --server-image. Studio pins images built
// from the same AX commit as its go.mod (749fa9c), so that setting up AX on
// this computer is one click. Each is multi-arch (amd64 and arm64) and pinned
// by digest. Replace them with AX's official images once they're published,
// together with the go.mod pin.
const (
	// DefaultServerImage is the ax-server image (--server-image).
	DefaultServerImage = "ghcr.io/yoyinzyc/ax/ax-server:v0.0.0-yczhou.1@sha256:b4381b8fe58e4e7572676fdfa04b14bdb8228c6160768ecf3d314023f183e9cd"
	// DefaultTaskImage is the image of a task that doesn't name one
	// (--default-task-image): a shell with AX's task runner.
	DefaultTaskImage = "ghcr.io/yoyinzyc/ax/ax-task-runner:v0.0.0-yczhou.1@sha256:0ec668d57c3fade9a9e2c6998c36876530540cee2a6963c55657cbf5dcb950c7"
)

// SetupImages are the images setup uses unless you choose others, and where
// each comes from: "env" when AX_SERVER_IMAGE or AX_DEFAULT_TASK_IMAGE sets it
// for Studio, "studio" for Studio's pinned default.
type SetupImages struct {
	ServerImage      string `json:"serverImage"`
	ServerImageFrom  string `json:"serverImageFrom"`
	TaskImage        string `json:"taskImage"`
	TaskImageFrom    string `json:"taskImageFrom"`
	TaskImageAllowed bool   `json:"taskImageAllowed"`
}

// setupImages says which images `ax local start` gets when the request names
// none. An image set in Studio's environment wins over Studio's default.
func setupImages(flags AXFlags) SetupImages {
	out := SetupImages{ServerImage: DefaultServerImage, ServerImageFrom: "studio", TaskImage: DefaultTaskImage, TaskImageFrom: "studio", TaskImageAllowed: flags.DefaultTaskImage}
	if v := strings.TrimSpace(os.Getenv("AX_SERVER_IMAGE")); v != "" {
		out.ServerImage, out.ServerImageFrom = v, "env"
	}
	if v := strings.TrimSpace(os.Getenv("AX_DEFAULT_TASK_IMAGE")); v != "" {
		out.TaskImage, out.TaskImageFrom = v, "env"
	}
	return out
}
