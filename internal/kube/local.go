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
	"context"
	"fmt"
	"strings"

	"github.com/google/ax/pkg/apis/v1alpha1"
)

const (
	// DefaultLocalClusterName is the default Kind cluster name managed by `ax local`.
	DefaultLocalClusterName = "ax-local"

	// StateNotFound indicates no Kind cluster containers exist for the local cluster.
	StateNotFound = "NotFound"
	// StateStopped indicates Kind node containers exist on disk/Docker but are stopped.
	StateStopped = "Stopped"
	// StateRunning indicates all Kind node containers are running.
	StateRunning = "Running"
)

// LocalStatus summarizes the local Kind + Substrate + AX stack health.
type LocalStatus struct {
	Name            string
	State           string
	KubeContext     string
	SubstrateStatus string
	AXStatus        string
}

// LocalKubeContextName returns the kubeconfig context name for a Kind cluster.
func LocalKubeContextName(clusterName string) string {
	if clusterName == "" || clusterName == DefaultLocalClusterName {
		return DefaultLocalClusterName
	}
	if clusterName == "local" {
		return "local"
	}
	return "kind-" + clusterName
}

// InspectLocalCluster probes the local Kind containers and Kubernetes deployments
// without mutating cluster state or downloading tools.
func InspectLocalCluster(ctx context.Context, r Runner, rt ContainerRuntime, clusterName, axNamespace string) LocalStatus {
	if r == nil {
		r = OSRunner{}
	}
	if clusterName == "" {
		clusterName = DefaultLocalClusterName
	}
	if axNamespace == "" {
		axNamespace = v1alpha1.DefaultSystemNamespace
	}
	kubeCtx := LocalKubeContextName(clusterName)
	st := LocalStatus{
		Name:            "N/A",
		State:           StateNotFound,
		KubeContext:     "N/A",
		SubstrateStatus: "N/A",
		AXStatus:        "N/A",
	}
	if rt.Binary == "" {
		return st
	}

	nodes := listKindNodes(ctx, r, rt, clusterName)
	if len(nodes) == 0 && clusterName == DefaultLocalClusterName {
		// Detect a legacy "local" cluster, the default name before google/ax#603 made it "ax-local".
		if legacyNodes := listKindNodes(ctx, r, rt, "local"); len(legacyNodes) > 0 {
			clusterName = "local"
			kubeCtx = "local"
			nodes = legacyNodes
		}
	}
	if len(nodes) == 0 {
		return st
	}
	if entries, err := ListContexts(""); err == nil {
		hasKubeCtx := false
		hasKindPrefix := false
		for _, e := range entries {
			if e.Name == kubeCtx {
				hasKubeCtx = true
			}
			if e.Name == "kind-"+clusterName {
				hasKindPrefix = true
			}
		}
		if !hasKubeCtx && hasKindPrefix {
			kubeCtx = "kind-" + clusterName
		}
	}
	st.Name = clusterName
	st.KubeContext = kubeCtx

	for _, node := range nodes {
		res, err := r.Run(ctx, Spec{
			Name: rt.Binary,
			Args: []string{"inspect", "-f", "{{.State.Running}}", node},
		})
		if err != nil || strings.TrimSpace(res.Stdout) != "true" {
			st.State = StateStopped
			return st
		}
	}
	st.State = StateRunning

	kubectlBin, err := ResolveKubectl(r)
	if err != nil || kubectlBin == "" {
		return st
	}

	// Probe Substrate control plane readiness + node proxy_arp sysctl.
	if res, err := r.Run(ctx, Spec{
		Name: kubectlBin,
		Args: []string{"--context", kubeCtx, "--request-timeout=4s", "-n", "ate-system", "get", "deployment", "ate-api-server", "-o", "jsonpath={.status.availableReplicas}/{.spec.replicas}"},
	}); err == nil && strings.TrimSpace(res.Stdout) != "" {
		st.SubstrateStatus = fmt.Sprintf("ate-api-server (%s available)", formatReplicaRatio(res.Stdout))
		if sysctlRes, sysctlErr := r.Run(ctx, Spec{
			Name: rt.Binary,
			Args: []string{"exec", nodes[0], "sysctl", "-n", "net.ipv4.conf.all.proxy_arp"},
		}); sysctlErr == nil && strings.TrimSpace(sysctlRes.Stdout) == "0" {
			st.SubstrateStatus += " [degraded: node sysctls reset after restart; run 'ax local start' to restore]"
		}
	} else {
		st.SubstrateStatus = "NotInstalled"
	}

	// Probe AX control plane readiness.
	if res, err := r.Run(ctx, Spec{
		Name: kubectlBin,
		Args: []string{"--context", kubeCtx, "--request-timeout=4s", "-n", axNamespace, "get", "deployment", "ax-server", "-o", "jsonpath={.status.availableReplicas}/{.spec.replicas}"},
	}); err == nil && strings.TrimSpace(res.Stdout) != "" {
		st.AXStatus = fmt.Sprintf("ax-server (%s available in %s)", formatReplicaRatio(res.Stdout), axNamespace)
	} else {
		st.AXStatus = "NotInstalled"
	}

	return st
}

func listKindNodes(ctx context.Context, r Runner, rt ContainerRuntime, clusterName string) []string {
	if kindBin, err := ResolveKind(r); err == nil && kindBin != "" {
		var env []string
		if rt.IsPodman {
			env = []string{"KIND_EXPERIMENTAL_PROVIDER=podman"}
		}
		if res, runErr := r.Run(ctx, Spec{
			Name: kindBin,
			Args: []string{"get", "nodes", "--name", clusterName},
			Env:  env,
		}); runErr == nil {
			var nodes []string
			for _, line := range strings.Split(res.Stdout, "\n") {
				if n := strings.TrimSpace(line); n != "" {
					nodes = append(nodes, n)
				}
			}
			if len(nodes) > 0 {
				return nodes
			}
		}
	}

	// Fallback: query container engine by Kind cluster label even before `kind` is downloaded.
	res, err := r.Run(ctx, Spec{
		Name: rt.Binary,
		Args: []string{"ps", "-a", "--filter", "label=io.x-k8s.kind.cluster=" + clusterName, "--format", "{{.Names}}"},
	})
	if err != nil {
		return nil
	}
	var nodes []string
	for _, line := range strings.Split(res.Stdout, "\n") {
		if n := strings.TrimSpace(line); n != "" {
			nodes = append(nodes, n)
		}
	}
	return nodes
}

func formatReplicaRatio(raw string) string {
	s := strings.TrimSpace(raw)
	if strings.HasPrefix(s, "/") {
		return "0" + s
	}
	return s
}
