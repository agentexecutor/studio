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

// Workspaces and Gateways: what tasks start from (a Workspace: repositories,
// files and setup) and what they can reach (a Gateway: the network rules).
// They outlive the tasks that use them, so Studio lists them and deletes the
// ones you no longer need, as `ax get` and `ax delete` do.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/google/ax/pkg/apis/v1alpha1"
	"google.golang.org/protobuf/proto"
)

// resourceListLimit is how many Workspaces (or Tasks) one list asks for;
// ax-server's own default is 50.
const resourceListLimit = 500

// handleListWorkspaces serves GET /api/workspaces?context=&atespace=:
// {"workspaces": [Workspace]}.
func (s *Server) handleListWorkspaces(w http.ResponseWriter, r *http.Request) {
	s.listResources(w, r, "workspaces", func(ctx context.Context, c v1alpha1.AXClient, atespace string) ([]proto.Message, error) {
		resp, err := c.ListWorkspaces(ctx, &v1alpha1.ListWorkspacesRequest{Atespace: atespace, Limit: resourceListLimit})
		if err != nil {
			return nil, err
		}
		out := make([]proto.Message, 0, len(resp.GetWorkspaces()))
		for _, x := range resp.GetWorkspaces() {
			out = append(out, x)
		}
		return out, nil
	})
}

// handleListGateways serves GET /api/gateways?context=&atespace=:
// {"gateways": [Gateway]}.
func (s *Server) handleListGateways(w http.ResponseWriter, r *http.Request) {
	s.listResources(w, r, "gateways", func(ctx context.Context, c v1alpha1.AXClient, atespace string) ([]proto.Message, error) {
		resp, err := c.ListGateways(ctx, &v1alpha1.ListGatewaysRequest{Atespace: atespace})
		if err != nil {
			return nil, err
		}
		out := make([]proto.Message, 0, len(resp.GetGateways()))
		for _, x := range resp.GetGateways() {
			out = append(out, x)
		}
		return out, nil
	})
}

// handleListModels serves GET /api/models?context=&atespace=: {"models": [Model]}.
func (s *Server) handleListModels(w http.ResponseWriter, r *http.Request) {
	s.listResources(w, r, "models", func(ctx context.Context, c v1alpha1.AXClient, atespace string) ([]proto.Message, error) {
		resp, err := c.ListModels(ctx, &v1alpha1.ListModelsRequest{Atespace: atespace})
		if err != nil {
			return nil, err
		}
		out := make([]proto.Message, 0, len(resp.GetModels()))
		for _, x := range resp.GetModels() {
			out = append(out, x)
		}
		return out, nil
	})
}

func (s *Server) listResources(w http.ResponseWriter, r *http.Request, key string, list func(context.Context, v1alpha1.AXClient, string) ([]proto.Message, error)) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	kubeCtx, atespace, err := taskScope(q.Get("context"), q.Get("atespace"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	client, conn, err := s.dialAXForContext(r.Context(), kubeCtx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(r.Context(), axReadTimeout)
	defer cancel()
	items, err := list(ctx, client, atespace)
	if err != nil {
		writeAXError(w, err)
		return
	}
	docs := make([]json.RawMessage, 0, len(items))
	for _, it := range items {
		b, err := taskJSON.Marshal(it)
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("encoding %s: %v", key, err))
			return
		}
		docs = append(docs, b)
	}
	writeJSON(w, http.StatusOK, map[string]any{key: docs})
}

// handleDeleteResource serves POST /api/workspaces/delete and
// /api/gateways/delete: {"context", "atespace", "name"}.
func (s *Server) handleDeleteResource(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req taskRef
		if err := decodeJSONBody(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		kubeCtx, atespace, err := taskScope(req.Context, req.Atespace)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		name := strings.TrimSpace(req.Name)
		if err := kube.ValidateName(name); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid %s name: %v", kind, err))
			return
		}
		client, conn, err := s.dialAXForContext(r.Context(), kubeCtx)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		defer conn.Close()
		ctx, cancel := context.WithTimeout(r.Context(), axActionTimeout)
		defer cancel()
		switch kind {
		case "workspace":
			_, err = client.DeleteWorkspace(ctx, &v1alpha1.DeleteWorkspaceRequest{Atespace: atespace, Name: name})
		case "gateway":
			_, err = client.DeleteGateway(ctx, &v1alpha1.DeleteGatewayRequest{Atespace: atespace, Name: name})
		default:
			err = errors.New("unknown resource")
		}
		if err != nil {
			writeAXError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
