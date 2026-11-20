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
// `ax local start` still leaves its own release defaults empty, so Studio
// pins official AX images built from the same AX release as its go.mod
// (v0.4.0-rc.1) for one-click local setup. Each is multi-arch (amd64 and arm64)
// and pinned by digest.
const (
	// DefaultServerImage is the ax-server image (--server-image).
	DefaultServerImage = "ghcr.io/google/ax/ax-server@sha256:95737151ccc54fdb8d99a8a8674f11777d7b08b7108a7b80820a1c502bb71223"
	// DefaultTaskImage is the image of a task that doesn't name one
	// (--default-task-image): a shell with AX's task runner.
	DefaultTaskImage = "ghcr.io/google/ax/ax-task-runner@sha256:3a61e70d70cede25cec04c34b2902e2febac08bd78741207101d5c102f6e7a2c"
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
