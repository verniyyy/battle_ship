package main

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

func TestEveryCardHasACompleteSheet(t *testing.T) {
	for _, c := range meta.Cards {
		d, ok := designs[c.ID]
		if !ok {
			t.Errorf("%s: no character sheet", c.ID)
			continue
		}
		for name, v := range map[string]string{"Hair": d.Hair, "Eyes": d.Eyes, "Face": d.Face, "Outfit": d.Outfit, "Legs": d.Legs, "Item": d.Item, "Pose": d.Pose, "Check": d.Check} {
			if strings.TrimSpace(v) == "" {
				t.Errorf("%s: %s is empty", c.ID, name)
			}
		}
	}
	for id := range designs {
		if _, ok := meta.CardByID(id); !ok {
			t.Errorf("sheet for unknown card %s", id)
		}
	}
}

func TestJobsAskForAFullBodyOnAPlainBackground(t *testing.T) {
	jobs, err := buildJobs(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != len(meta.Cards) {
		t.Fatalf("%d jobs for %d cards", len(jobs), len(meta.Cards))
	}
	seeds := map[int]string{}
	for _, j := range jobs {
		for _, want := range []string{"1girl", "full body", "standing", "simple background", "masterpiece"} {
			if !strings.Contains(j.Prompt, want) {
				t.Errorf("%s: prompt lacks %q", j.ID, want)
			}
		}
		if !strings.Contains(j.Negative, "feet out of frame") {
			t.Errorf("%s: negative does not guard the framing", j.ID)
		}
		if strings.Contains(j.DetailNegative, "close-up") {
			t.Errorf("%s: detail negative fights the detail crop", j.ID)
		}
		if strings.Contains(j.TilePrompt, "1girl") {
			t.Errorf("%s: tile prompt invites a face into every tile", j.ID)
		}
		if len(j.Require) == 0 || !strings.HasSuffix(j.Require[0], "_hair") || strings.Contains(strings.Join(j.Expect, ","), " ") {
			t.Errorf("%s: require = %q, expect = %q", j.ID, j.Require, j.Expect)
		}
		if strings.Contains(j.Prompt, ", ,") || strings.Contains(j.Prompt, "standing, standing") {
			t.Errorf("%s: malformed prompt %q", j.ID, j.Prompt)
		}
		if other, dup := seeds[j.Seed]; dup {
			t.Errorf("%s and %s share seed %d", j.ID, other, j.Seed)
		}
		seeds[j.Seed] = j.ID
	}
	if _, err := buildJobs([]string{"nope"}); err == nil {
		t.Error("unknown id accepted")
	}
}

// Effects, scenery and rigging are what made the first generation of art
// look cheap; no sheet may ask for them, and every pass must forbid them.
func TestPromptsAskForTheCharacterOnly(t *testing.T) {
	banned := []string{"glowing", "sparkle", "aura", "lightning", "electricity", "fire", "flame", "embers", "petals", "cherry blossoms",
		"bubbles", "snowflakes", "light rays", "sunlight", "moon", "wings", "rigging", "turret", "cannon", "divine"}
	jobs, err := buildJobs(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, j := range jobs {
		for _, p := range []string{j.Prompt, j.FacePrompt, j.HandPrompt, j.TilePrompt} {
			for tag := range strings.SplitSeq(p, ",") {
				tag = strings.TrimSpace(tag)
				for _, b := range banned {
					if tag == b || strings.HasPrefix(tag, b+" ") || strings.HasSuffix(tag, " "+b) {
						t.Errorf("%s: prompt asks for %q", j.ID, tag)
					}
				}
			}
		}
		for _, want := range []string{"sparkle", "lightning", "high contrast", "moon", "rigging"} {
			if !strings.Contains(j.Negative, want) {
				t.Errorf("%s: negative lacks %q", j.ID, want)
			}
		}
		if !strings.Contains(j.DetailNegative, "sparkle") {
			t.Errorf("%s: detail passes may paint effects back in", j.ID)
		}
	}
}

func TestPaleHairGetsAGreyBackground(t *testing.T) {
	if got := background(designs["ca_shirasagi"]); !strings.Contains(got, "grey background") {
		t.Errorf("white-haired shirasagi on %q", got)
	}
	if got := background(designs["bb_guren"]); !strings.Contains(got, "white background") {
		t.Errorf("red-haired guren on %q", got)
	}
}

func TestTagsDropsEmptiesAndDuplicates(t *testing.T) {
	got := tags("a, b", "", " b ,c,, ", "a")
	if got != "a, b, c" {
		t.Errorf("tags = %q", got)
	}
}

func TestKitBundlesPackageAndJobs(t *testing.T) {
	out := filepath.Join(t.TempDir(), "kit.zip")
	if err := kitCmd([]string{"-out", out, "-only", "bb_kurogane,dd_asanagi", "-src", "../../../tools/portraitgen"}); err != nil {
		t.Fatal(err)
	}
	zr, err := zip.OpenReader(out)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	names := map[string]*zip.File{}
	for _, f := range zr.File {
		names[f.Name] = f
	}
	for _, want := range []string{"pyproject.toml", "portraitgen/__init__.py", "portraitgen/run.py", "jobs.json"} {
		if names[want] == nil {
			t.Errorf("kit lacks %s", want)
		}
	}
	var kit struct{ Jobs []job }
	if err := readJSON(names["jobs.json"], &kit); err != nil {
		t.Fatal(err)
	}
	if len(kit.Jobs) != 2 || kit.Jobs[0].ID != "bb_kurogane" {
		t.Errorf("jobs = %+v", kit.Jobs)
	}
}

func TestInstallWritesManifestAndKeepsEarlierImports(t *testing.T) {
	dir := t.TempDir()
	first := writeZip(t, map[string]string{
		"bb_kurogane.webp": "one",
		"portraits.json":   `{"bb_kurogane": {"w": 900, "h": 1500, "face": [0.4, 0.1, 0.6, 0.2]}}`,
	})
	if n, err := install(first, dir); err != nil || n != 1 {
		t.Fatalf("install = %d, %v", n, err)
	}
	second := writeZip(t, map[string]string{
		"dd_asanagi.webp":  "two",
		"not_a_card.webp":  "x",
		"portraits.json":   `{"dd_asanagi": {"w": 800, "h": 1400, "face": [0.45, 0.12, 0.62, 0.22]}, "not_a_card": {"w": 1, "h": 1}}`,
		"extra/readme.txt": "ignored",
	})
	if n, err := install(second, dir); err != nil || n != 1 {
		t.Fatalf("install = %d, %v", n, err)
	}

	var m manifest
	buf, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(buf, &m); err != nil {
		t.Fatal(err)
	}
	if m.Version != manifestVersion || len(m.Portraits) != 2 {
		t.Fatalf("manifest = %+v", m)
	}
	p := m.Portraits["dd_asanagi"]
	if !strings.HasPrefix(p.File, "dd_asanagi.webp?v=") || p.W != 800 || p.Face[1] != 0.12 {
		t.Errorf("dd_asanagi = %+v", p)
	}
	if _, err := os.Stat(filepath.Join(dir, "not_a_card.webp")); err == nil {
		t.Error("installed a file for an unknown card")
	}

	third := writeZip(t, map[string]string{
		"bb_kurogane.webp":        "three",
		"staged/bb_kurogane.webp": "scene",
		"portraits.json":          `{"bb_kurogane": {"w": 900, "h": 1500, "face": [0.4, 0.1, 0.6, 0.2], "staged": {"w": 1248, "h": 1824, "face": [0.45, 0.2, 0.55, 0.28]}}}`,
	})
	if n, err := install(third, dir); err != nil || n != 1 {
		t.Fatalf("install = %d, %v", n, err)
	}
	m = readManifest(dir)
	st := m.Portraits["bb_kurogane"].Staged
	if st == nil || !strings.HasPrefix(st.File, "staged/bb_kurogane.webp?v=") || st.W != 1248 || st.Face[1] != 0.2 {
		t.Fatalf("staged = %+v", st)
	}
	if buf, _ := os.ReadFile(filepath.Join(dir, "staged", "bb_kurogane.webp")); string(buf) != "scene" {
		t.Errorf("staged file = %q", buf)
	}
	if buf, _ := os.ReadFile(filepath.Join(dir, "bb_kurogane.webp")); string(buf) != "three" {
		t.Errorf("portrait file = %q, the staged one must not overwrite it", buf)
	}
	// A new portrait without a staged illustration drops the stale one.
	if _, err := install(first, dir); err != nil {
		t.Fatal(err)
	}
	if m = readManifest(dir); m.Portraits["bb_kurogane"].Staged != nil || exists(filepath.Join(dir, "staged", "bb_kurogane.webp")) {
		t.Errorf("stale staged illustration kept: %+v", m.Portraits["bb_kurogane"])
	}

	if _, err := install(writeZip(t, map[string]string{"a.webp": "x"}), dir); err == nil {
		t.Error("zip without portraits.json accepted")
	}
}

func writeZip(t *testing.T, files map[string]string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "p.zip")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, body := range files {
		w, _ := zw.Create(name)
		w.Write([]byte(body))
	}
	zw.Close()
	f.Close()
	return p
}

// Only high-rarity cards get a staged illustration, and its instruction
// carries the whole stage while holding on to the figure.
func TestStageIsForHighRaritiesAndAllowsItsEffects(t *testing.T) {
	jobs, err := buildJobs(nil)
	if err != nil {
		t.Fatal(err)
	}
	staged := 0
	for _, j := range jobs {
		c, _ := meta.CardByID(j.ID)
		d := designs[j.ID]
		if j.Color != c.Color {
			t.Errorf("%s: color %q", j.ID, j.Color)
		}
		if d.Stage == "" {
			if j.StageInstruction != "" {
				t.Errorf("%s: stage prompts without a stage", j.ID)
			}
			continue
		}
		staged++
		if c.Rarity < meta.SR {
			t.Errorf("%s: stage on a %s card", j.ID, c.Rarity)
		}
		for tag := range strings.SplitSeq(d.Stage, ",") {
			tag = strings.TrimSpace(tag)
			if !strings.Contains(j.StageInstruction, tag) {
				t.Errorf("%s: stage tag %q missing from the instruction", j.ID, tag)
			}
		}
		if !strings.Contains(j.StageInstruction, "Keep the girl") {
			t.Errorf("%s: stage prompts do not hold on to the figure", j.ID)
		}
	}
	if staged == 0 {
		t.Error("no card has a stage")
	}
}
