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

// Task logs: what a task's sandbox printed, read from the Agent Substrate
// worker that runs it.
//
// Agent Substrate's workers (pods labelled ate.dev/worker-pool) log one JSON
// object per line for every actor (sandbox) they run, labelled with the
// actor's name, atespace and container. A task's actor has the task's name.
// Studio reads the workers' logs with kubectl, as the desktop app does, and
// keeps the lines of one task.

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
)

// TaskLogLine is one line a task's sandbox printed.
type TaskLogLine struct {
	// Time is when the worker logged it (RFC 3339).
	Time string `json:"t,omitempty"`
	// Source is "agent" (the task's own command), "runner" (AX's task runner
	// in the sandbox), "sandbox" (gVisor starting or restoring the sandbox) or
	// "event" (the worker starting, pausing, restoring or stopping it).
	Source string `json:"src"`
	Text   string `json:"text"`
}

// TaskLogsResponse is returned by GET /api/tasks/logs.
type TaskLogsResponse struct {
	Lines []TaskLogLine `json:"lines"`
	// Namespaces are where the workers run. None means the cluster runs no
	// Agent Substrate workers that Studio can see.
	Namespaces []string `json:"namespaces"`
	// Truncated is set when there were more lines than Studio returns.
	Truncated bool `json:"truncated,omitempty"`
	// Command reads the same logs from the command line (all actors, unfiltered).
	Command string `json:"command"`
}

const (
	// maxTaskLogLines is the most lines one answer carries (the newest).
	maxTaskLogLines = 2000
	// workerTail bounds what one read asks each worker container for.
	workerTail = "20000"
	// workerNSTTL is how long the workers' namespaces are kept per cluster.
	workerNSTTL = time.Minute
	// workerPoolLabel selects Agent Substrate's worker pods.
	workerPoolLabel = "ate.dev/worker-pool"
)

var (
	// glogLine is gVisor's own log format ("I1118 05:33:41.706683 134 cli.go:282] ...").
	glogLine = regexp.MustCompile(`^[IWEF]\d{4} \d{2}:\d{2}:\d{2}\.\d+\s+\d+ [\w.\-]+:\d+\] `)
	// runnerLine is the AX task runner's (Go slog text: "time=... level=INFO msg=...").
	runnerLine = regexp.MustCompile(`^time=\S+ level=\w+ `)
)

// workerNamespaces caches where each cluster's workers run.
type workerNamespaces struct {
	mu sync.Mutex
	m  map[string]workerNSEntry
}

type workerNSEntry struct {
	ns []string
	at time.Time
}

// handleTaskLogs serves GET /api/tasks/logs?context=&atespace=&name=&since=:
// the lines one task's sandbox printed in the last 24 hours, oldest first.
// since (RFC 3339) asks only for lines from then on; the answer can repeat a
// few lines from that same second.
func (s *Server) handleTaskLogs(w http.ResponseWriter, r *http.Request) {
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
	var since time.Time
	if raw := strings.TrimSpace(q.Get("since")); raw != "" {
		if since, err = time.Parse(time.RFC3339Nano, raw); err != nil {
			writeError(w, http.StatusBadRequest, "since must be an RFC 3339 time")
			return
		}
	}
	res, err := s.taskLogs(r.Context(), kubeCtx, atespace, name, since)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// taskLogs reads every worker's logs and keeps one task's lines.
func (s *Server) taskLogs(ctx context.Context, kubeCtx, atespace, name string, since time.Time) (TaskLogsResponse, error) {
	out := TaskLogsResponse{Lines: []TaskLogLine{}, Namespaces: []string{}}
	kubectl, err := kube.ResolveKubectl(s.runner)
	if err != nil || kubectl == "" {
		return out, fmt.Errorf("kubectl isn't installed, so Studio can't read the logs. Set up AX on this computer once (it downloads kubectl), or install kubectl")
	}
	base := []string{}
	if kubeCtx != "" {
		base = append(base, "--context", kubeCtx)
	}
	k := func(timeout time.Duration, args ...string) (kube.Result, error) {
		cctx, cancel := context.WithTimeout(ctx, timeout)
		defer cancel()
		return s.runner.Run(cctx, kube.Spec{Name: kubectl, Args: append(append([]string{}, base...), args...)})
	}

	nss, err := s.workerNamespacesFor(kubeCtx, func() (kube.Result, error) {
		return k(15*time.Second, "--request-timeout=10s", "get", "pods", "-A", "-l", workerPoolLabel,
			"-o", `jsonpath={range .items[*]}{.metadata.namespace}{"\n"}{end}`)
	})
	if err != nil {
		return out, err
	}
	out.Namespaces = nss
	ctxFlag := ""
	if kubeCtx != "" {
		ctxFlag = "--context " + kubeCtx + " "
	}
	ns0 := "<namespace>"
	if len(nss) > 0 {
		ns0 = nss[0]
	}
	out.Command = fmt.Sprintf("kubectl %s-n %s logs -l %s --all-containers --prefix=false --since=24h", ctxFlag, ns0, workerPoolLabel)

	window := []string{"--since=24h"}
	if !since.IsZero() {
		window = []string{"--since-time=" + since.UTC().Format(time.RFC3339)}
	}
	lines := []TaskLogLine{}
	var firstErr error
	for _, ns := range nss {
		args := append([]string{"-n", ns, "logs", "-l", workerPoolLabel, "--all-containers", "--prefix=false",
			"--ignore-errors", "--max-log-requests=50", "--tail=" + workerTail}, window...)
		res, err := k(25*time.Second, args...)
		if err != nil && strings.TrimSpace(res.Stdout) == "" {
			if firstErr == nil {
				firstErr = fmt.Errorf("reading the worker logs in %s: %s", ns, nonEmptyStr(lastLine(res.Stderr), err.Error()))
			}
			continue
		}
		lines = append(lines, filterTaskLog(res.Stdout, atespace, name, since)...)
	}
	if len(lines) == 0 && firstErr != nil {
		return out, firstErr
	}
	// Lines from different workers arrive one worker after another.
	sort.SliceStable(lines, func(i, j int) bool { return lines[i].Time < lines[j].Time })
	if len(lines) > maxTaskLogLines {
		lines = lines[len(lines)-maxTaskLogLines:]
		out.Truncated = true
	}
	out.Lines = lines
	return out, nil
}

// workerNamespacesFor returns where the cluster's workers run, asking with
// list at most once a minute.
func (s *Server) workerNamespacesFor(kubeCtx string, list func() (kube.Result, error)) ([]string, error) {
	c := &s.extras.workerNS
	c.mu.Lock()
	if e, ok := c.m[kubeCtx]; ok && time.Since(e.at) < workerNSTTL {
		c.mu.Unlock()
		return e.ns, nil
	}
	c.mu.Unlock()
	res, err := list()
	if err != nil {
		return nil, fmt.Errorf("finding Agent Substrate's workers: %s", nonEmptyStr(lastLine(res.Stderr), err.Error()))
	}
	seen := map[string]bool{}
	nss := []string{}
	for _, ns := range strings.Fields(res.Stdout) {
		if !seen[ns] {
			seen[ns] = true
			nss = append(nss, ns)
		}
	}
	sort.Strings(nss)
	c.mu.Lock()
	if c.m == nil {
		c.m = map[string]workerNSEntry{}
	}
	c.m[kubeCtx] = workerNSEntry{ns: nss, at: time.Now()}
	c.mu.Unlock()
	return nss, nil
}

// filterTaskLog keeps the lines of one actor from the workers' JSON logs, from
// since on when it is set. Lines that aren't JSON, or name no actor, are the
// workers' own and are dropped, as are the _sandbox container's.
func filterTaskLog(raw, atespace, name string, since time.Time) []TaskLogLine {
	var out []TaskLogLine
	sc := bufio.NewScanner(strings.NewReader(raw))
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || line[0] != '{' || !strings.Contains(line, name) {
			continue
		}
		var rec struct {
			Labels  map[string]string `json:"logging.googleapis.com/labels"`
			Labels2 map[string]string `json:"labels"`
			Message any               `json:"message"`
			Msg     any               `json:"msg"`
			Time    string            `json:"time"`
		}
		if json.Unmarshal([]byte(line), &rec) != nil {
			continue
		}
		labels := rec.Labels
		if labels == nil {
			labels = rec.Labels2
		}
		if labels["ate.actor.name"] != name {
			continue
		}
		if ns := labels["ate.atespace"]; ns != "" && ns != atespace {
			continue
		}
		container := labels["ate.actor.container.name"]
		if container == "_sandbox" {
			continue
		}
		if !since.IsZero() {
			if t, err := time.Parse(time.RFC3339Nano, rec.Time); err == nil && t.Before(since.Truncate(time.Second)) {
				continue
			}
		}
		text := logText(rec.Message)
		if text == "" {
			text = logText(rec.Msg)
		}
		if text == "" {
			continue
		}
		src := "agent"
		switch {
		case container == "":
			src = "event"
		case glogLine.MatchString(text):
			src = "sandbox"
		case runnerLine.MatchString(text):
			src = "runner"
		}
		out = append(out, TaskLogLine{Time: rec.Time, Source: src, Text: text})
	}
	return out
}

// logText is a log record's message as one string.
func logText(v any) string {
	switch m := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimRight(m, "\r\n")
	default:
		b, _ := json.Marshal(m)
		return string(b)
	}
}
