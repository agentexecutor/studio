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

//go:build unix

package studio

import (
	"os"

	"golang.org/x/sys/unix"
)

// A terminal's settings: line editing, echo, signals and output processing.
type termios = unix.Termios

// getTermios reads the settings of the terminal f is either end of.
func getTermios(f *os.File) (*termios, error) {
	rc, err := f.SyscallConn()
	if err != nil {
		return nil, err
	}
	var t *termios
	var ioErr error
	if err := rc.Control(func(fd uintptr) {
		t, ioErr = unix.IoctlGetTermios(int(fd), ioctlGetTermios)
	}); err != nil {
		return nil, err
	}
	return t, ioErr
}

// setTermios changes the settings of the terminal f is either end of.
func setTermios(f *os.File, t *termios) error {
	rc, err := f.SyscallConn()
	if err != nil {
		return err
	}
	var ioErr error
	if err := rc.Control(func(fd uintptr) {
		ioErr = unix.IoctlSetTermios(int(fd), ioctlSetTermios, t)
	}); err != nil {
		return err
	}
	return ioErr
}

// makeRawTermios returns t in raw mode, as cfmakeraw(3) sets it: bytes pass
// through as they are, with no echo, line editing, signals or output
// processing.
func makeRawTermios(t termios) termios {
	t.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP | unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	t.Oflag &^= unix.OPOST
	t.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	t.Cflag &^= unix.CSIZE | unix.PARENB
	t.Cflag |= unix.CS8
	t.Cc[unix.VMIN] = 1
	t.Cc[unix.VTIME] = 0
	return t
}
