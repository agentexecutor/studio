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
	"fmt"
	"net/http"
	"strings"

	"github.com/agentexecutor/studio/internal/kube"
)

// secretKeysTemplate prints "found" and then the secret's key names, one per
// line. It never prints a value.
const secretKeysTemplate = `found{{"\n"}}{{range $k, $v := .data}}{{$k}}{{"\n"}}{{end}}`

// handleCredentialSecretStatus says whether a credential secret exists and has
// the key a Gateway rule reads, so New task can tell you whether an agent's API
// key is already stored. It reads key names only; values never leave the cluster.
func (s *Server) handleCredentialSecretStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	name := strings.TrimSpace(q.Get("name"))
	key := strings.TrimSpace(q.Get("key"))
	kubeCtx := strings.TrimSpace(q.Get("context"))
	ns := strings.TrimSpace(q.Get("namespace"))
	if ns == "" {
		ns = s.axNamespace
	}
	if err := kube.ValidateName(name); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid secret name: %v", err))
		return
	}
	if err := kube.ValidateName(ns); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid namespace: %v", err))
		return
	}
	if !secretKeyRe.MatchString(key) {
		writeError(w, http.StatusBadRequest, "invalid secret key name")
		return
	}
	if strings.HasPrefix(kubeCtx, "-") {
		writeError(w, http.StatusBadRequest, "invalid context name")
		return
	}
	kubectlBin, err := kube.ResolveKubectl(s.runner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "kubectl is not available")
		return
	}
	args := []string{}
	if kubeCtx != "" {
		args = append(args, "--context", kubeCtx)
	}
	args = append(args, "-n", ns, "get", "secret", name, "--ignore-not-found", "-o", "go-template="+secretKeysTemplate)
	res, err := s.runner.Run(r.Context(), kube.Spec{Name: kubectlBin, Args: args})
	if err != nil {
		lines := strings.Split(strings.TrimSpace(res.Stderr), "\n")
		writeError(w, http.StatusBadGateway, nonEmptyStr(strings.TrimSpace(lines[len(lines)-1]), "couldn't read the secret"))
		return
	}
	exists, hasKey := false, false
	for i, line := range strings.Split(res.Stdout, "\n") {
		line = strings.TrimSpace(line)
		if i == 0 {
			exists = line == "found"
			continue
		}
		if line == key {
			hasKey = true
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"namespace": ns,
		"name":      name,
		"key":       key,
		"exists":    exists,
		"hasKey":    exists && hasKey,
	})
}
