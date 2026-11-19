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

// When setting up AX fails, the command often only says that it timed out
// waiting for a rollout. The reason is on the cluster: a pod whose image can't
// be pulled, that keeps crashing, or that can't be scheduled. This file finds
// those pods, says what Kubernetes said about each, and what it most likely
// means, so that a person or an agent can act on it right away.

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
)

// PodProblem is a pod that can't start, as Kubernetes reports it.
type PodProblem struct {
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container,omitempty"`
	Image     string `json:"image,omitempty"`
	// Reason is why the container waits (ErrImagePull, ImagePullBackOff,
	// CrashLoopBackOff...) or Unschedulable.
	Reason string `json:"reason"`
	// Message is what Kubernetes said: the pull's error, the scheduler's.
	Message string `json:"message,omitempty"`
	// Hint is what the message most likely means, when Studio knows.
	Hint string `json:"hint,omitempty"`
}

// maxPodProblems is how many problems are reported: the first few say why.
const maxPodProblems = 6

var (
	// unreachableRe matches a pull that couldn't reach the registry.
	unreachableRe = regexp.MustCompile(`(?i)i/o timeout|dial tcp|tls handshake timeout|no such host|connection refused|network is unreachable|context deadline exceeded|client\.timeout`)
	// refusedRe matches a registry that refused the pull.
	refusedRe = regexp.MustCompile(`(?i)unauthorized|denied|forbidden|authentication required|\b40[13]\b`)
	// missingImageRe matches an image the registry doesn't have.
	missingImageRe = regexp.MustCompile(`(?i)not found|manifest unknown|name unknown`)
	// noRoomRe matches a scheduler that found no node with room for the pod.
	noRoomRe = regexp.MustCompile(`(?i)insufficient (memory|cpu)`)
)

// isPullReason says whether a container waits on its image.
func isPullReason(reason string) bool {
	return reason == "ErrImagePull" || reason == "ImagePullBackOff" || reason == "InvalidImageName" || reason == "ErrImageNeverPull"
}

// localKubeContext is the kubeconfig context `ax local start --name` makes:
// ax-local for the default cluster, kind-<name> for the others.
func localKubeContext(name string) string {
	if name == "" || name == defaultLocalClusterName {
		return defaultLocalClusterName
	}
	return "kind-" + name
}

// podProblems lists the pods on kubeCtx that can't start, with what
// Kubernetes said about each and a hint. local says the cluster runs on this
// computer, which changes what a registry that can't be reached means.
func (s *Server) podProblems(ctx context.Context, kubeCtx string, local bool) []PodProblem {
	kubectl, err := kube.ResolveKubectl(s.runner)
	if err != nil || kubectl == "" || kubeCtx == "" {
		return nil
	}
	get := func(args ...string) (string, bool) {
		c, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		res, err := s.runner.Run(c, kube.Spec{Name: kubectl, Args: append([]string{"--context", kubeCtx, "--request-timeout=8s", "get"}, args...)})
		return res.Stdout, err == nil
	}
	pods, ok := get("pods", "-A", "-o", "json")
	if !ok {
		return nil
	}
	problems := parsePodProblems(pods)
	if len(problems) == 0 {
		return nil
	}
	// A kubelet may put only "Back-off pulling image" on the pod. The pull's
	// own error is in the pod's events then.
	if events, ok := get("events", "-A", "--field-selector", "type=Warning", "-o", "json"); ok {
		addPullErrors(problems, events)
	}
	for i := range problems {
		problems[i].Hint = podProblemHint(problems[i], kubeCtx, local)
	}
	return problems
}

// containerStatus is the part of a pod's container status this file reads.
type containerStatus struct {
	Name  string `json:"name"`
	Image string `json:"image"`
	State struct {
		Waiting *struct {
			Reason  string `json:"reason"`
			Message string `json:"message"`
		} `json:"waiting"`
	} `json:"state"`
	LastState struct {
		Terminated *struct {
			Reason   string `json:"reason"`
			Message  string `json:"message"`
			ExitCode int    `json:"exitCode"`
		} `json:"terminated"`
	} `json:"lastState"`
}

// parsePodProblems reads `kubectl get pods -o json`: the containers that wait
// for a reason other than starting, and the pods that can't be scheduled.
// Pulls come first, then crashes, then scheduling.
func parsePodProblems(podsJSON string) []PodProblem {
	var list struct {
		Items []struct {
			Metadata struct {
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"metadata"`
			Status struct {
				Conditions []struct {
					Type    string `json:"type"`
					Status  string `json:"status"`
					Reason  string `json:"reason"`
					Message string `json:"message"`
				} `json:"conditions"`
				InitContainerStatuses []containerStatus `json:"initContainerStatuses"`
				ContainerStatuses     []containerStatus `json:"containerStatuses"`
			} `json:"status"`
		} `json:"items"`
	}
	if json.Unmarshal([]byte(podsJSON), &list) != nil {
		return nil
	}
	var out []PodProblem
	for _, pod := range list.Items {
		at := PodProblem{Namespace: pod.Metadata.Namespace, Pod: pod.Metadata.Name}
		for _, c := range append(pod.Status.InitContainerStatuses, pod.Status.ContainerStatuses...) {
			w := c.State.Waiting
			if w == nil || w.Reason == "" || w.Reason == "ContainerCreating" || w.Reason == "PodInitializing" {
				continue
			}
			p := at
			p.Container, p.Image, p.Reason, p.Message = c.Name, c.Image, w.Reason, strings.TrimSpace(w.Message)
			if t := c.LastState.Terminated; w.Reason == "CrashLoopBackOff" && t != nil {
				p.Message = strings.TrimSpace(fmt.Sprintf("Last exit: %s, exit code %d. %s", nonEmptyStr(t.Reason, "Error"), t.ExitCode, t.Message))
			}
			out = append(out, p)
		}
		for _, cond := range pod.Status.Conditions {
			if cond.Type == "PodScheduled" && cond.Status == "False" && cond.Reason == "Unschedulable" {
				p := at
				p.Reason, p.Message = cond.Reason, strings.TrimSpace(cond.Message)
				out = append(out, p)
			}
		}
	}
	rank := func(p PodProblem) int {
		switch {
		case isPullReason(p.Reason):
			return 0
		case p.Reason == "Unschedulable":
			return 2
		}
		return 1
	}
	sort.SliceStable(out, func(i, j int) bool { return rank(out[i]) < rank(out[j]) })
	if len(out) > maxPodProblems {
		out = out[:maxPodProblems]
	}
	return out
}

// addPullErrors puts the latest "Failed to pull image" event of each pod on
// the problems that wait on an image, when it says more than the pod does.
func addPullErrors(problems []PodProblem, eventsJSON string) {
	var list struct {
		Items []struct {
			InvolvedObject struct {
				Kind      string `json:"kind"`
				Name      string `json:"name"`
				Namespace string `json:"namespace"`
			} `json:"involvedObject"`
			Message       string `json:"message"`
			LastTimestamp string `json:"lastTimestamp"`
			EventTime     string `json:"eventTime"`
		} `json:"items"`
	}
	if json.Unmarshal([]byte(eventsJSON), &list) != nil {
		return
	}
	latest := map[string]string{}
	when := map[string]string{}
	for _, ev := range list.Items {
		if ev.InvolvedObject.Kind != "Pod" || !strings.HasPrefix(ev.Message, "Failed to pull image") {
			continue
		}
		key := ev.InvolvedObject.Namespace + "/" + ev.InvolvedObject.Name
		t := nonEmptyStr(ev.LastTimestamp, ev.EventTime)
		if _, seen := latest[key]; !seen || t >= when[key] {
			latest[key], when[key] = strings.TrimSpace(ev.Message), t
		}
	}
	for i, p := range problems {
		if msg := latest[p.Namespace+"/"+p.Pod]; msg != "" && isPullReason(p.Reason) && len(msg) > len(p.Message) {
			problems[i].Message = msg
		}
	}
}

// podProblemHint says what a problem on kubeCtx most likely means, or "".
func podProblemHint(p PodProblem, kubeCtx string, local bool) string {
	switch {
	case p.Reason == "InvalidImageName":
		return "The image reference isn't valid. Check its name, tag and digest."
	case isPullReason(p.Reason) && unreachableRe.MatchString(p.Message):
		if local {
			return "The cluster can't reach the image registry. Containers on this computer may have no way out: check that docker info shows IPv4Forwarding: true, and any proxy or firewall."
		}
		return "The cluster's nodes can't reach the image registry. Check the cluster's outbound access to it: NAT, firewall or proxy."
	case isPullReason(p.Reason) && refusedRe.MatchString(p.Message):
		return "The registry refused the pull. If the image is private, the cluster needs credentials for it."
	case isPullReason(p.Reason) && missingImageRe.MatchString(p.Message):
		return "The registry doesn't have this image. Check its name, tag and digest."
	case p.Reason == "Unschedulable" && noRoomRe.MatchString(p.Message):
		return "No node has enough memory or CPU free for this pod."
	case p.Reason == "CrashLoopBackOff":
		return fmt.Sprintf("The container starts and exits again. Its last logs say why: kubectl --context %s -n %s logs %s -c %s --previous", kubeCtx, p.Namespace, p.Pod, p.Container)
	}
	return ""
}

// isLocalContextName says whether a kubeconfig context is a cluster on this
// computer, by the names ax and kind give them.
func isLocalContextName(name string) bool {
	return name == defaultLocalClusterName || name == "local" || strings.HasPrefix(name, "kind-")
}

// explainFailure looks for pods that can't start on the cluster a failed
// setup or install ran on, and puts them on the operation.
func (s *Server) explainFailure(opID, action, target string) {
	kubeCtx := target
	if action == "local-up" {
		kubeCtx = localKubeContext(target)
	}
	parent := s.shutdownCtx
	if parent == nil {
		parent = context.Background()
	}
	problems := s.podProblems(parent, kubeCtx, isLocalContextName(kubeCtx))
	if len(problems) == 0 {
		return
	}
	s.opMu.Lock()
	if s.currentOp != nil && s.currentOp.ID == opID {
		s.currentOp.Problems = problems
	}
	s.opMu.Unlock()
}

// podProblemLines writes the problems as lines for logs and diagnostics.
func podProblemLines(problems []PodProblem) []string {
	var out []string
	for _, p := range problems {
		who := p.Namespace + "/" + p.Pod
		if p.Container != "" {
			who += " (" + p.Container + ")"
		}
		line := fmt.Sprintf("%s: %s", who, p.Reason)
		if p.Message != "" {
			line += ": " + p.Message
		}
		out = append(out, line)
		if p.Hint != "" {
			out = append(out, "  Hint: "+p.Hint)
		}
	}
	return out
}
