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
	"errors"
	"fmt"
	"regexp"
	"strings"
)

var dns1123LabelRe = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// ValidateName verifies that name is a valid RFC 1123 DNS label (1..63 lowercase
// alphanumeric characters or '-', starting and ending with alphanumeric).
func ValidateName(name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return errors.New("name is required")
	}
	if len(trimmed) > 63 {
		return fmt.Errorf("name %q exceeds 63 characters", trimmed)
	}
	if !dns1123LabelRe.MatchString(trimmed) {
		return fmt.Errorf("name %q must consist of lowercase alphanumeric characters or '-', and start and end with an alphanumeric character", trimmed)
	}
	return nil
}
