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

// Running a task on another cluster (or in another atespace) without
// `ax promote`, which not every ax has: Studio copies the task, and the
// Workspace and Gateway it binds when the destination lacks them, through the
// AX API, then starts it there. As the desktop app's Move does, it can also
// copy the sandbox's /workspace across (tar over two `ax ssh`), which needs
// debug access and both copies running. What happens to the original is your
// choice: keep it, pause it, or delete it once the copy runs.

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/google/ax/pkg/apis/v1alpha1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// moveRequest is the body of POST /api/tasks/move.
type moveRequest struct {
	Context    string `json:"context"`
	Atespace   string `json:"atespace"`
	Name       string `json:"name"`
	ToContext  string `json:"toContext"`
	ToAtespace string `json:"toAtespace"`
	// Original is what happens here once the copy runs: "keep" (the
	// default), "suspend" or "delete".
	Original string `json:"original"`
	// NoResume leaves the copy paused there.
	NoResume bool `json:"noResume"`
	// CopyFiles copies the sandbox's /workspace across.
	CopyFiles bool `json:"copyFiles"`
	// Replace deletes a task of the same name there first.
	Replace bool `json:"replace"`
	// DryRun only says what would happen.
	DryRun bool `json:"dryRun"`
}

// MoveItem is one thing a move creates, reuses or replaces there.
type MoveItem struct {
	Kind   string `json:"kind"`   // "gateway" | "workspace" | "task"
	Name   string `json:"name"`   // its name
	Action string `json:"action"` // "create" | "reuse" | "replace"
}

// MovePlan is what a move would do, and what stops it.
type MovePlan struct {
	Items    []MoveItem `json:"items"`
	Problems []string   `json:"problems"`
	// Keys are the Secrets the task's Gateway names; the destination needs
	// its own copies, as they aren't copied.
	Keys []string `json:"keys"`
	// Path is the task's working directory, which CopyFiles copies.
	Path string `json:"path"`
	// Debug says whether the task has debug access, which CopyFiles needs.
	Debug bool `json:"debug"`
}

const (
	// moveWait is how long a move waits for a task to reach a state.
	moveWait = 3 * time.Minute
	// movePoll is how often it looks.
	movePoll = 2 * time.Second
)

// credentialURIRe finds the Secrets a Gateway adds to requests.
var credentialURIRe = regexp.MustCompile(`"credentialUri"\s*:\s*"([^"]+)"`)

// handleTaskMove serves POST /api/tasks/move. With dryRun it answers the
// plan; otherwise it starts the move as the environment operation
// "task-move" (its progress streams like setup's) and answers that.
func (s *Server) handleTaskMove(w http.ResponseWriter, r *http.Request) {
	var req moveRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var err error
	if req.Context, req.Atespace, err = taskScope(req.Context, req.Atespace); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.ToContext, req.ToAtespace, err = taskScope(req.ToContext, req.ToAtespace); err != nil {
		writeError(w, http.StatusBadRequest, "destination: "+err.Error())
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if err := kube.ValidateName(req.Name); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid task name: %v", err))
		return
	}
	switch req.Original {
	case "":
		req.Original = "keep"
	case "keep", "suspend", "delete":
	default:
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid original %q", req.Original))
		return
	}
	if req.DryRun {
		ctx, cancel := context.WithTimeout(r.Context(), axActionTimeout)
		defer cancel()
		plan, err := s.withMoveClients(req, func(src, dst v1alpha1.AXClient) (MovePlan, error) {
			p, _, err := planMove(ctx, src, dst, req)
			return p, err
		})
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, plan)
		return
	}
	to := req.ToContext + "/" + req.ToAtespace
	snap, err := s.startEnvOperationFor("task-move", "", req.Name, "", func(ctx context.Context, lw *opLogWriter) error {
		_, err := s.withMoveClients(req, func(src, dst v1alpha1.AXClient) (MovePlan, error) {
			return MovePlan{}, s.moveTask(ctx, lw, src, dst, req)
		})
		return err
	}, func(op *EnvOpSnapshot) { op.To = to })
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, snap)
}

// withMoveClients dials AX on both ends.
func (s *Server) withMoveClients(req moveRequest, fn func(src, dst v1alpha1.AXClient) (MovePlan, error)) (MovePlan, error) {
	src, srcConn, err := s.dialAXForContext(req.Context)
	if err != nil {
		return MovePlan{}, fmt.Errorf("reaching AX on %s: %w", nameOrCurrent(req.Context), err)
	}
	defer srcConn.Close()
	var dst v1alpha1.AXClient
	var dstConn *grpc.ClientConn
	if req.ToContext == req.Context {
		dst = src
	} else {
		if dst, dstConn, err = s.dialAXForContext(req.ToContext); err != nil {
			return MovePlan{}, fmt.Errorf("reaching AX on %s: %w", nameOrCurrent(req.ToContext), err)
		}
		defer dstConn.Close()
	}
	return fn(src, dst)
}

func nameOrCurrent(kubeCtx string) string {
	if kubeCtx == "" {
		return "the current context"
	}
	return kubeCtx
}

// moveParts is what planMove read from the source.
type moveParts struct {
	task      *v1alpha1.Task
	workspace *v1alpha1.Workspace
	gateway   *v1alpha1.Gateway
	exists    bool // a task of that name is already there
}

// planMove reads the task and what it binds, and looks at the destination.
func planMove(ctx context.Context, src, dst v1alpha1.AXClient, req moveRequest) (MovePlan, moveParts, error) {
	plan := MovePlan{Items: []MoveItem{}, Problems: []string{}, Keys: []string{}}
	var parts moveParts
	if req.Context == req.ToContext && req.Atespace == req.ToAtespace {
		plan.Problems = append(plan.Problems, "That's where it is now. Pick another cluster or atespace.")
		return plan, parts, nil
	}
	task, err := src.GetTask(ctx, &v1alpha1.GetTaskRequest{Atespace: req.Atespace, Name: req.Name})
	if err != nil {
		return plan, parts, fmt.Errorf("reading %s: %s", req.Name, grpcMessage(err))
	}
	parts.task = task
	plan.Debug = task.GetSpec().GetDebug()
	plan.Path = task.GetSpec().GetWorkspace().GetPath()
	if plan.Path == "" {
		plan.Path = "/workspace"
	}
	if gw := task.GetSpec().GetGateway().GetName(); gw != "" {
		g, err := src.GetGateway(ctx, &v1alpha1.GetGatewayRequest{Atespace: req.Atespace, Name: gw})
		if err != nil {
			return plan, parts, fmt.Errorf("reading its Gateway %s: %s", gw, grpcMessage(err))
		}
		parts.gateway = g
		plan.Items = append(plan.Items, MoveItem{Kind: "gateway", Name: gw, Action: existsAction(func() error {
			_, err := dst.GetGateway(ctx, &v1alpha1.GetGatewayRequest{Atespace: req.ToAtespace, Name: gw})
			return err
		})})
		if b, err := protojson.Marshal(g.GetSpec()); err == nil {
			seen := map[string]bool{}
			for _, m := range credentialURIRe.FindAllStringSubmatch(string(b), -1) {
				if parts := strings.Split(m[1], "/"); len(parts) >= 2 && !seen[parts[len(parts)-2]] {
					seen[parts[len(parts)-2]] = true
					plan.Keys = append(plan.Keys, parts[len(parts)-2])
				}
			}
			sort.Strings(plan.Keys)
		}
	}
	if ws := task.GetSpec().GetWorkspace().GetName(); ws != "" {
		w, err := src.GetWorkspace(ctx, &v1alpha1.GetWorkspaceRequest{Atespace: req.Atespace, Name: ws})
		if err != nil {
			return plan, parts, fmt.Errorf("reading its workspace %s: %s", ws, grpcMessage(err))
		}
		parts.workspace = w
		plan.Items = append(plan.Items, MoveItem{Kind: "workspace", Name: ws, Action: existsAction(func() error {
			_, err := dst.GetWorkspace(ctx, &v1alpha1.GetWorkspaceRequest{Atespace: req.ToAtespace, Name: ws})
			return err
		})})
	}
	_, err = dst.GetTask(ctx, &v1alpha1.GetTaskRequest{Atespace: req.ToAtespace, Name: req.Name})
	switch {
	case err == nil:
		parts.exists = true
		if req.Replace {
			plan.Items = append(plan.Items, MoveItem{Kind: "task", Name: req.Name, Action: "replace"})
		} else {
			plan.Items = append(plan.Items, MoveItem{Kind: "task", Name: req.Name, Action: "create"})
			plan.Problems = append(plan.Problems, fmt.Sprintf("A task named %s is already there. Turn on Replace to delete it first.", req.Name))
		}
	case status.Code(err) == codes.NotFound:
		plan.Items = append(plan.Items, MoveItem{Kind: "task", Name: req.Name, Action: "create"})
	default:
		return plan, parts, fmt.Errorf("reaching AX there: %s", grpcMessage(err))
	}
	if req.CopyFiles && !plan.Debug {
		plan.Problems = append(plan.Problems, "Copying its files goes through ax ssh, which needs debug access, and this task was started without it.")
	}
	return plan, parts, nil
}

// existsAction is "reuse" when get finds the resource there, else "create".
func existsAction(get func() error) string {
	if get() == nil {
		return "reuse"
	}
	return "create"
}

// grpcMessage is what ax-server said, without the gRPC wrapping.
func grpcMessage(err error) string {
	if st, ok := status.FromError(err); ok {
		return st.Message()
	}
	return err.Error()
}

// portableMeta is a resource's metadata as the destination should get it.
func portableMeta(m *v1alpha1.ObjectMeta, atespace string) *v1alpha1.ObjectMeta {
	out := &v1alpha1.ObjectMeta{Name: m.GetName(), Atespace: atespace}
	if len(m.GetLabels()) > 0 {
		out.Labels = map[string]string{}
		for k, v := range m.GetLabels() {
			out.Labels[k] = v
		}
	}
	return out
}

// moveTask does the move, saying each step as `ax` would.
func (s *Server) moveTask(ctx context.Context, lw io.Writer, src, dst v1alpha1.AXClient, req moveRequest) error {
	say := func(format string, a ...any) { fmt.Fprintf(lw, "==> "+format+"\n", a...) }
	there := fmt.Sprintf("%s (atespace %s)", nameOrCurrent(req.ToContext), req.ToAtespace)
	say("Reading %s and what it uses on %s", req.Name, nameOrCurrent(req.Context))
	plan, parts, err := planMove(ctx, src, dst, req)
	if err != nil {
		return err
	}
	if len(plan.Problems) > 0 {
		return errors.New(plan.Problems[0])
	}
	if parts.exists && req.Replace {
		say("Deleting the task %s that is already on %s", req.Name, there)
		if _, err := dst.DeleteTask(ctx, &v1alpha1.DeleteTaskRequest{Atespace: req.ToAtespace, Name: req.Name}); err != nil {
			return fmt.Errorf("deleting the task there: %s", grpcMessage(err))
		}
		if err := waitTask(ctx, dst, req.ToAtespace, req.Name, ""); err != nil {
			return err
		}
	}
	for _, it := range plan.Items {
		switch {
		case it.Kind == "gateway" && it.Action == "create":
			say("Creating the Gateway %s on %s", it.Name, there)
			g := proto.Clone(parts.gateway).(*v1alpha1.Gateway)
			g.Metadata = portableMeta(parts.gateway.GetMetadata(), req.ToAtespace)
			if _, err := dst.CreateGateway(ctx, &v1alpha1.CreateGatewayRequest{Gateway: g}); err != nil {
				return fmt.Errorf("creating the Gateway there: %s", grpcMessage(err))
			}
		case it.Kind == "workspace" && it.Action == "create":
			say("Creating the workspace %s on %s", it.Name, there)
			w := proto.Clone(parts.workspace).(*v1alpha1.Workspace)
			w.Metadata = portableMeta(parts.workspace.GetMetadata(), req.ToAtespace)
			w.Status = nil
			if _, err := dst.CreateWorkspace(ctx, &v1alpha1.CreateWorkspaceRequest{Workspace: w}); err != nil {
				return fmt.Errorf("creating the workspace there: %s", grpcMessage(err))
			}
		case it.Action == "reuse":
			say("Using the %s %s that is already on %s", it.Kind, it.Name, there)
		}
	}
	say("Creating %s on %s", req.Name, there)
	t := proto.Clone(parts.task).(*v1alpha1.Task)
	t.Metadata = portableMeta(parts.task.GetMetadata(), req.ToAtespace)
	t.Status = nil
	if _, err := dst.CreateTask(ctx, &v1alpha1.CreateTaskRequest{Task: t}); err != nil {
		return fmt.Errorf("creating the task there: %s", grpcMessage(err))
	}
	switch {
	case req.CopyFiles:
		say("Starting both copies")
		if err := ensureWorking(ctx, src, req.Atespace, req.Name); err != nil {
			return fmt.Errorf("here: %w", err)
		}
		if err := ensureWorking(ctx, dst, req.ToAtespace, req.Name); err != nil {
			return fmt.Errorf("there: %w", err)
		}
		say("Copying %s", plan.Path)
		if err := s.copyWorkspace(ctx, req, plan.Path); err != nil {
			return err
		}
		say("Restarting the copy on the copied files")
		if _, err := dst.SuspendTask(ctx, &v1alpha1.SuspendTaskRequest{Atespace: req.ToAtespace, Name: req.Name}); err != nil {
			return fmt.Errorf("pausing the copy: %s", grpcMessage(err))
		}
		if err := waitTask(ctx, dst, req.ToAtespace, req.Name, "Suspended"); err != nil {
			return err
		}
		if !req.NoResume {
			if _, err := dst.ResumeTask(ctx, &v1alpha1.ResumeTaskRequest{Atespace: req.ToAtespace, Name: req.Name}); err != nil {
				return fmt.Errorf("starting the copy: %s", grpcMessage(err))
			}
		}
	case !req.NoResume:
		say("Starting %s on %s", req.Name, there)
		if _, err := dst.ResumeTask(ctx, &v1alpha1.ResumeTaskRequest{Atespace: req.ToAtespace, Name: req.Name}); err != nil {
			return fmt.Errorf("starting it there: %s", grpcMessage(err))
		}
	default:
		say("Leaving %s paused on %s", req.Name, there)
	}
	switch req.Original {
	case "suspend":
		say("Pausing %s on %s", req.Name, nameOrCurrent(req.Context))
		if _, err := src.SuspendTask(ctx, &v1alpha1.SuspendTaskRequest{Atespace: req.Atespace, Name: req.Name}); err != nil && status.Code(err) != codes.FailedPrecondition {
			return fmt.Errorf("pausing it here: %s", grpcMessage(err))
		}
	case "delete":
		say("Deleting %s on %s", req.Name, nameOrCurrent(req.Context))
		if _, err := src.DeleteTask(ctx, &v1alpha1.DeleteTaskRequest{Atespace: req.Atespace, Name: req.Name}); err != nil {
			return fmt.Errorf("deleting it here: %s", grpcMessage(err))
		}
	}
	say("%s is on %s", req.Name, there)
	return nil
}

// stateWord is a task state as `ax get tasks` prints it ("Working").
func stateWord(st v1alpha1.TaskState) string {
	parts := strings.Split(strings.TrimPrefix(st.String(), "TASK_STATE_"), "_")
	for i, p := range parts {
		parts[i] = strings.ToUpper(p[:1]) + strings.ToLower(p[1:])
	}
	return strings.Join(parts, "")
}

// waitTask waits until the task is in state want ("" means gone).
func waitTask(ctx context.Context, c v1alpha1.AXClient, atespace, name, want string) error {
	deadline := time.Now().Add(moveWait)
	for {
		t, err := c.GetTask(ctx, &v1alpha1.GetTaskRequest{Atespace: atespace, Name: name})
		switch {
		case want == "" && status.Code(err) == codes.NotFound:
			return nil
		case err != nil && want != "":
			return fmt.Errorf("reading %s: %s", name, grpcMessage(err))
		case err == nil && want != "":
			got := stateWord(t.GetStatus().GetState())
			if got == want {
				return nil
			}
			if got == "Failed" {
				return fmt.Errorf("%s failed while Studio waited for it to be %s", name, want)
			}
		}
		if time.Now().After(deadline) {
			if want == "" {
				return fmt.Errorf("%s is still there after %s", name, moveWait)
			}
			return fmt.Errorf("%s isn't %s after %s", name, want, moveWait)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(movePoll):
		}
	}
}

// ensureWorking resumes a paused task and waits until it is Working.
func ensureWorking(ctx context.Context, c v1alpha1.AXClient, atespace, name string) error {
	t, err := c.GetTask(ctx, &v1alpha1.GetTaskRequest{Atespace: atespace, Name: name})
	if err != nil {
		return fmt.Errorf("reading %s: %s", name, grpcMessage(err))
	}
	switch stateWord(t.GetStatus().GetState()) {
	case "Working":
		return nil
	case "Suspended", "Completed", "Cancelled":
		if _, err := c.ResumeTask(ctx, &v1alpha1.ResumeTaskRequest{Atespace: atespace, Name: name}); err != nil {
			return fmt.Errorf("starting %s: %s", name, grpcMessage(err))
		}
	}
	return waitTask(ctx, c, atespace, name, "Working")
}

// copyWorkspace streams path from the task here to its copy there: tar over
// `ax ssh` on both ends. It runs the processes itself so the archive flows
// through instead of being held in memory.
func (s *Server) copyWorkspace(ctx context.Context, req moveRequest, path string) error {
	scope := func(kubeCtx, atespace string) []string {
		a := []string{"-n", s.axNamespace}
		if kubeCtx != "" {
			a = append(a, "--context", kubeCtx)
		}
		return append(a, "-a", atespace)
	}
	from := append(scope(req.Context, req.Atespace), "ssh", req.Name, "--", "tar", "cf", "-", "-C", path, ".")
	to := append(scope(req.ToContext, req.ToAtespace), "ssh", req.Name, "--", "tar", "xf", "-", "-C", path)
	if s.extras.pipeAX != nil {
		return s.extras.pipeAX(ctx, from, to)
	}
	return pipeCommands(ctx, s.axBinary, from, to)
}

// pipeCommands runs `bin from... | bin to...`.
func pipeCommands(ctx context.Context, bin string, from, to []string) error {
	src := exec.CommandContext(ctx, bin, from...)
	dst := exec.CommandContext(ctx, bin, to...)
	pr, pw := io.Pipe()
	src.Stdout = pw
	dst.Stdin = pr
	var srcErr, dstErr strings.Builder
	src.Stderr = &srcErr
	dst.Stderr = &dstErr
	if err := dst.Start(); err != nil {
		return fmt.Errorf("starting ax ssh there: %w", err)
	}
	if err := src.Start(); err != nil {
		_ = pw.Close()
		_ = dst.Wait()
		return fmt.Errorf("starting ax ssh here: %w", err)
	}
	errSrc := src.Wait()
	_ = pw.CloseWithError(errSrc)
	errDst := dst.Wait()
	if errSrc != nil {
		return fmt.Errorf("reading the files here: %s", nonEmptyStr(lastLine(srcErr.String()), errSrc.Error()))
	}
	if errDst != nil {
		return fmt.Errorf("writing the files there: %s", nonEmptyStr(lastLine(dstErr.String()), errDst.Error()))
	}
	return nil
}
