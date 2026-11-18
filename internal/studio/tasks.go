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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/google/ax/pkg/apis/v1alpha1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// Task endpoints for the web UI.
//
// They call ax-server directly, so the UI gets each Task as data (the same
// JSON `protojson` produces for the v1alpha1 API) instead of reading the text
// tables that `ax get` prints.

const (
	// axReadTimeout bounds a read from ax-server once it has been reached.
	axReadTimeout = 20 * time.Second
	// axActionTimeout bounds a suspend, resume or delete.
	axActionTimeout = 60 * time.Second
)

// taskJSON writes a resource the way the v1alpha1 API documents it: camelCase
// field names and enum values by name.
var taskJSON = protojson.MarshalOptions{}

// taskRef names a task for the suspend, resume and delete endpoints.
type taskRef struct {
	Context  string `json:"context"`
	Atespace string `json:"atespace"`
	Name     string `json:"name"`
}

// taskScope checks the cluster and atespace a request names. An empty context
// means the kubeconfig's current one; an empty atespace means "default".
func taskScope(kubeCtx, atespace string) (string, string, error) {
	kubeCtx = strings.TrimSpace(kubeCtx)
	if strings.HasPrefix(kubeCtx, "-") || strings.ContainsAny(kubeCtx, " \t\r\n") {
		return "", "", fmt.Errorf("invalid context %q", kubeCtx)
	}
	atespace = strings.TrimSpace(atespace)
	if atespace == "" {
		atespace = v1alpha1.DefaultAtespace
	}
	if err := kube.ValidateName(atespace); err != nil {
		return "", "", fmt.Errorf("invalid atespace: %w", err)
	}
	return kubeCtx, atespace, nil
}

// writeAXError reports a failed call to ax-server. The body carries what
// ax-server said and, when it was a gRPC status, the status code by name.
func writeAXError(w http.ResponseWriter, err error) {
	st, ok := status.FromError(err)
	if !ok {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	httpCode := http.StatusBadGateway
	switch st.Code() {
	case codes.NotFound:
		httpCode = http.StatusNotFound
	case codes.InvalidArgument:
		httpCode = http.StatusBadRequest
	case codes.DeadlineExceeded:
		httpCode = http.StatusGatewayTimeout
	}
	writeJSON(w, httpCode, map[string]string{"error": st.Message(), "code": st.Code().String()})
}

// jsonToYAML renders a JSON document as block-style YAML, keeping the order of
// its keys. It is how the UI shows a Task as a file.
func jsonToYAML(doc []byte) (string, error) {
	var node yaml.Node
	// JSON is YAML, so the YAML decoder reads it, and a Node keeps key order.
	if err := yaml.Unmarshal(doc, &node); err != nil {
		return "", err
	}
	clearYAMLStyle(&node)
	var out bytes.Buffer
	enc := yaml.NewEncoder(&out)
	enc.SetIndent(2)
	if err := enc.Encode(&node); err != nil {
		return "", err
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return out.String(), nil
}

// clearYAMLStyle drops the flow and quoting styles a node took from its JSON
// source. The encoder still quotes the strings that need it.
func clearYAMLStyle(n *yaml.Node) {
	n.Style = 0
	for _, c := range n.Content {
		clearYAMLStyle(c)
	}
}

// handleListTasks serves GET /api/tasks?context=&atespace= with the tasks of
// an atespace: {"tasks": [Task, ...]}.
func (s *Server) handleListTasks(w http.ResponseWriter, r *http.Request) {
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
	client, conn, err := s.dialAXForContext(kubeCtx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(r.Context(), axReadTimeout)
	defer cancel()
	resp, err := client.ListTasks(ctx, &v1alpha1.ListTasksRequest{Atespace: atespace})
	if err != nil {
		writeAXError(w, err)
		return
	}
	tasks := make([]json.RawMessage, 0, len(resp.GetTasks()))
	for _, t := range resp.GetTasks() {
		b, err := taskJSON.Marshal(t)
		if err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("encoding task: %v", err))
			return
		}
		tasks = append(tasks, b)
	}
	writeJSON(w, http.StatusOK, map[string]any{"tasks": tasks})
}

// handleGetTask serves GET /api/tasks/get?context=&atespace=&name= with one
// task, as data and as the YAML file a person would read: {"task": Task,
// "yaml": "..."}.
func (s *Server) handleGetTask(w http.ResponseWriter, r *http.Request) {
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
	name := strings.TrimSpace(q.Get("name"))
	if err := kube.ValidateName(name); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid task name: %v", err))
		return
	}
	client, conn, err := s.dialAXForContext(kubeCtx)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(r.Context(), axReadTimeout)
	defer cancel()
	task, err := client.GetTask(ctx, &v1alpha1.GetTaskRequest{Atespace: atespace, Name: name})
	if err != nil {
		writeAXError(w, err)
		return
	}
	doc, err := taskJSON.Marshal(task)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("encoding task: %v", err))
		return
	}
	// The YAML is for reading. If it can't be produced the task still loads.
	file, _ := jsonToYAML(doc)
	writeJSON(w, http.StatusOK, map[string]any{"task": json.RawMessage(doc), "yaml": file})
}

// handleTaskAction serves POST /api/tasks/{suspend,resume,delete} for the
// task the body names.
func (s *Server) handleTaskAction(action string) http.HandlerFunc {
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
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid task name: %v", err))
			return
		}
		client, conn, err := s.dialAXForContext(kubeCtx)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		defer conn.Close()

		ctx, cancel := context.WithTimeout(r.Context(), axActionTimeout)
		defer cancel()
		switch action {
		case "suspend":
			_, err = client.SuspendTask(ctx, &v1alpha1.SuspendTaskRequest{Atespace: atespace, Name: name})
		case "resume":
			_, err = client.ResumeTask(ctx, &v1alpha1.ResumeTaskRequest{Atespace: atespace, Name: name})
		case "delete":
			_, err = client.DeleteTask(ctx, &v1alpha1.DeleteTaskRequest{Atespace: atespace, Name: name})
		default:
			err = errors.New("unknown task action")
		}
		if err != nil {
			writeAXError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}
