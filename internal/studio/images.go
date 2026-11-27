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
// (v0.4.0-rc.2) for one-click local setup. Each is multi-arch (amd64 and arm64)
// and pinned by digest.
const (
	// DefaultServerImage is the ax-server image (--server-image).
	DefaultServerImage = "ghcr.io/google/ax/ax-server@sha256:0f2e31a9c6e143df613dd7cb03460b8ea48169305268022f92a96503894aefbd"
	// DefaultRunnerVolumeImage is the runner volume (--runner-volume-image):
	// AX's task runner, mounted into every task at /usr/local/bin/ax-runner.
	// Agent images such as agentexecutor/images' agy-cli don't ship a runner
	// of their own, so without it their tasks can't start.
	DefaultRunnerVolumeImage = "ghcr.io/google/ax/ax-runner-volume@sha256:a85dc4ac3e4b060d9157e3f80c01463544e79a0e92106bacad1e4f3f3cf5e4d5"
	// DefaultTaskImage is the image of a task that doesn't name one
	// (--default-task-image), for an ax that still takes the flag: a shell
	// with AX's task runner.
	DefaultTaskImage = "ghcr.io/google/ax/ax-runner@sha256:0937ebe5ad2d8db6bb25e88ded44d2d65de1b1bd8f0a9a97c6bb3787407d9947"
)

// SetupImages are the images setup uses unless you choose others, and where
// each comes from: "env" when AX_SERVER_IMAGE, AX_DEFAULT_TASK_IMAGE or
// AX_RUNNER_VOLUME_IMAGE sets it for Studio, "studio" for Studio's pinned
// default.
type SetupImages struct {
	ServerImage              string `json:"serverImage"`
	ServerImageFrom          string `json:"serverImageFrom"`
	TaskImage                string `json:"taskImage"`
	TaskImageFrom            string `json:"taskImageFrom"`
	TaskImageAllowed         bool   `json:"taskImageAllowed"`
	RunnerVolumeImage        string `json:"runnerVolumeImage"`
	RunnerVolumeImageFrom    string `json:"runnerVolumeImageFrom"`
	RunnerVolumeImageAllowed bool   `json:"runnerVolumeImageAllowed"`
}

// setupImages says which images `ax local start` gets when the request names
// none. An image set in Studio's environment wins over Studio's default.
func setupImages(flags AXFlags) SetupImages {
	out := SetupImages{
		ServerImage: DefaultServerImage, ServerImageFrom: "studio",
		TaskImage: DefaultTaskImage, TaskImageFrom: "studio", TaskImageAllowed: flags.DefaultTaskImage,
		RunnerVolumeImage: DefaultRunnerVolumeImage, RunnerVolumeImageFrom: "studio", RunnerVolumeImageAllowed: flags.RunnerVolumeImage,
	}
	if v := strings.TrimSpace(os.Getenv("AX_SERVER_IMAGE")); v != "" {
		out.ServerImage, out.ServerImageFrom = v, "env"
	}
	if v := strings.TrimSpace(os.Getenv("AX_DEFAULT_TASK_IMAGE")); v != "" {
		out.TaskImage, out.TaskImageFrom = v, "env"
	}
	if v := strings.TrimSpace(os.Getenv("AX_RUNNER_VOLUME_IMAGE")); v != "" {
		out.RunnerVolumeImage, out.RunnerVolumeImageFrom = v, "env"
	}
	return out
}
