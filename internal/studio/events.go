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
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Event represents a server-sent event pushed to connected Studio browser clients.
type Event struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

const (
	// hubQueue is how many events wait for each browser connection.
	hubQueue = 256
	// flowWait is how long PublishFlow waits for room in a connection's queue,
	// and flowSkip how long it then stops waiting for that connection.
	flowWait = 2 * time.Second
	flowSkip = 10 * time.Second
)

// hubClient is one browser connection to /api/events.
type hubClient struct {
	ch   chan []byte
	gone chan struct{}
	// slowUntil is when PublishFlow waits for this connection again, in Unix
	// nanoseconds, after it once had no room.
	slowUntil atomic.Int64
}

// Hub broadcasts Studio events over Server-Sent Events (SSE).
type Hub struct {
	mu      sync.RWMutex
	clients map[*hubClient]struct{}
}

// NewHub creates a new SSE broadcast hub.
func NewHub() *Hub {
	return &Hub{
		clients: make(map[*hubClient]struct{}),
	}
}

// Publish encodes and broadcasts an event to all active SSE subscribers.
func (h *Hub) Publish(eventType string, payload any) {
	data, err := json.Marshal(Event{Type: eventType, Payload: payload})
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for c := range h.clients {
		select {
		case c.ch <- data:
		default:
			// Drop slow consumer frames rather than blocking backend workers.
		}
	}
}

// PublishFlow broadcasts an event that must not be lost, such as a terminal's
// output. When a connection's queue is full it waits up to flowWait for room,
// so what produces the events slows to the pace the browser reads them. A
// connection that still has no room misses the event, and is not waited for
// again for flowSkip, so one stuck browser tab can't hold up the others.
func (h *Hub) PublishFlow(eventType string, payload any) {
	data, err := json.Marshal(Event{Type: eventType, Payload: payload})
	if err != nil {
		return
	}
	h.mu.RLock()
	clients := make([]*hubClient, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()
	for _, c := range clients {
		select {
		case c.ch <- data:
			continue
		default:
		}
		if time.Now().UnixNano() < c.slowUntil.Load() {
			continue
		}
		t := time.NewTimer(flowWait)
		select {
		case c.ch <- data:
		case <-c.gone:
		case <-t.C:
			c.slowUntil.Store(time.Now().Add(flowSkip).UnixNano())
		}
		t.Stop()
	}
}

func (h *Hub) serveSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	c := &hubClient{ch: make(chan []byte, hubQueue), gone: make(chan struct{})}
	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.clients, c)
		h.mu.Unlock()
		close(c.gone)
	}()

	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	keepalive := time.NewTicker(20 * time.Second)
	defer keepalive.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-keepalive.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case msg := <-c.ch:
			_, _ = fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		}
	}
}
