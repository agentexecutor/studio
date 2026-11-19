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

package kube

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// ContextEntry describes a configured kubeconfig context.
type ContextEntry struct {
	Name    string
	Cluster string
	User    string
	Current bool
}

type kubeConfig struct {
	CurrentContext string `yaml:"current-context"`
	Contexts       []struct {
		Name    string `yaml:"name"`
		Context struct {
			Cluster string `yaml:"cluster"`
			User    string `yaml:"user"`
		} `yaml:"context"`
	} `yaml:"contexts"`
}

func kubeconfigPaths() []string {
	if p := os.Getenv("KUBECONFIG"); p != "" {
		var out []string
		for _, item := range filepath.SplitList(p) {
			if item != "" {
				out = append(out, item)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return []string{filepath.Join(home, ".kube", "config")}
	}
	return nil
}

// KubeconfigPaths returns the kubeconfig files Studio reads contexts from:
// $KUBECONFIG when it is set, otherwise ~/.kube/config.
func KubeconfigPaths() []string { return kubeconfigPaths() }

// CurrentContext returns the active Kubernetes context from override, $KUBECONTEXT,
// or kubeconfig. Switching the context is left to `ax ctx <name>`.
func CurrentContext(override string) (string, error) {
	if override != "" {
		return override, nil
	}
	if env := os.Getenv("KUBECONTEXT"); env != "" {
		return env, nil
	}
	if ctx, parsed := readCurrentContext(kubeconfigPaths()); parsed {
		return ctx, nil
	}
	kubectlBin, err := ResolveKubectl(nil)
	if err != nil || kubectlBin == "" {
		return "", nil
	}
	out, err := exec.Command(kubectlBin, "config", "current-context").Output()
	if err != nil {
		return "", nil
	}
	return strings.TrimSpace(string(out)), nil
}

// readCurrentContext reads `current-context` across kubeconfig files and returns
// it only if a matching entry exists in `contexts` (ignoring dangling names).
func readCurrentContext(paths []string) (string, bool) {
	var active string
	known := make(map[string]bool)
	parsed := false

	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var cfg kubeConfig
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			continue
		}
		parsed = true
		if active == "" && cfg.CurrentContext != "" {
			active = cfg.CurrentContext
		}
		for _, c := range cfg.Contexts {
			known[c.Name] = true
		}
	}
	if !known[active] {
		return "", parsed
	}
	return active, parsed
}

// ListContexts returns all contexts defined in the user's kubeconfig files,
// sorted by name, with Current set on the active context.
func ListContexts(overrideCurrent string) ([]ContextEntry, error) {
	active, _ := CurrentContext(overrideCurrent)
	seen := make(map[string]ContextEntry)

	for _, path := range kubeconfigPaths() {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var cfg kubeConfig
		if err := yaml.Unmarshal(data, &cfg); err != nil {
			continue
		}
		for _, c := range cfg.Contexts {
			if c.Name == "" {
				continue
			}
			if _, exists := seen[c.Name]; !exists {
				seen[c.Name] = ContextEntry{
					Name:    c.Name,
					Cluster: c.Context.Cluster,
					User:    c.Context.User,
					Current: c.Name == active,
				}
			}
		}
	}

	out := make([]ContextEntry, 0, len(seen))
	for _, entry := range seen {
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}
