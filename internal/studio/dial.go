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
	"context"
	"sync"

	axclient "github.com/google/ax/client"
	"github.com/google/ax/pkg/apis/v1alpha1"
	"google.golang.org/grpc"
)

// ServerResolver resolves the address of the ax-server that opts selects. The
// default is the ax client's ServerURL, which shares its port-forwards with
// the ax CLI.
type ServerResolver func(ctx context.Context, opts axclient.Options) (string, error)

// dialAXForContext returns a client for the ax-server of kubeCtx. The caller
// closes the connection. Cancelling ctx stops the wait for a port-forward that
// is still starting; one that is already up is shared and outlives ctx.
func (s *Server) dialAXForContext(ctx context.Context, kubeCtx string) (v1alpha1.AXClient, *grpc.ClientConn, error) {
	// Resolving may start a port-forward. Requests for the same context take
	// turns, so two of them never start two.
	s.dialMu.Lock()
	lock := s.dialLocks[kubeCtx]
	if lock == nil {
		lock = &sync.Mutex{}
		s.dialLocks[kubeCtx] = lock
	}
	s.dialMu.Unlock()
	lock.Lock()
	serverURL, err := s.resolveServer(ctx, axclient.Options{Context: kubeCtx, Namespace: s.axNamespace})
	lock.Unlock()
	if err != nil {
		return nil, nil, err
	}
	return axclient.Dial(ctx, axclient.Options{ServerURL: serverURL})
}
