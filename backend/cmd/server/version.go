package main

import (
	"cmp"
	"os"
	"runtime/debug"
)

// version names the source this server was built from. Deploys set
// APP_VERSION (see the justfile), because neither the Vercel build nor the
// Docker build can see .git; a plain `go build` in the repository falls back
// to the commit Go stamped into the binary.
func version() string {
	if v := os.Getenv("APP_VERSION"); v != "" {
		return v
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "dev"
	}
	var rev, dirty string
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			rev = s.Value[:min(7, len(s.Value))]
		case "vcs.modified":
			if s.Value == "true" {
				dirty = "-dirty"
			}
		}
	}
	return cmp.Or(rev, "dev") + dirty
}
