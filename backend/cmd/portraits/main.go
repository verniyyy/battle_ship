// Command portraits is the local half of the character-art pipeline. The
// images are generated on a GPU (a free Google Colab T4 is enough) by the
// Python package in tools/portraitgen; this command feeds it and installs
// what it produces.
//
//	go run ./cmd/portraits kit                           # -> ../.cache/portraits/kit.zip
//	go run ./cmd/portraits import ~/Downloads/portraits.zip
//
// kit bundles tools/portraitgen with jobs.json, the prompts built from each
// card's character sheet (characters.go). import copies the finished
// <card id>.webp files into frontend/public/portraits and records their
// framing metadata in manifest.json there, which the frontend reads.
package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"io"
	"io/fs"
	"log"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

const usage = `usage:
  portraits kit    [-out file] [-only ids]   bundle the generator and prompts for the GPU notebook
  portraits import [-dir dir] portraits.zip  install finished portraits and update manifest.json
`

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	var err error
	switch cmd, args := os.Args[1], os.Args[2:]; cmd {
	case "kit":
		err = kitCmd(args)
	case "import":
		err = importCmd(args)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		log.Fatal(err)
	}
}

// ---- prompts ----

type job struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Seed       int    `json:"seed"`
	Prompt     string `json:"prompt"`
	Negative   string `json:"negative"`
	FacePrompt string `json:"face_prompt"`
	HandPrompt string `json:"hand_prompt"`
	TilePrompt string `json:"tile_prompt"`
	// The detail passes see a crop, so they must not be told to avoid close-ups.
	DetailNegative string `json:"detail_negative"`
	// Tagger tags (underscored, as the tagger names them) a good render shows:
	// one of Require (the hair colour) or it is rejected; missing Expect
	// tags (the item, which the tagger may overlook) only lower its rank.
	Require []string `json:"require"`
	Expect  []string `json:"expect"`
}

const (
	// Quality tags as the Illustrious family (WAI in particular) expects them.
	quality = "masterpiece, best quality, amazing quality, very aesthetic, absurdres, newest"
	// The look of official gacha character art: clean lines and soft, even
	// light, instead of the model's default dramatic contrast.
	// Kept free of body parts: it goes into the hand and tile prompts too.
	style = "official art, clean lineart, soft shading, soft lighting, even lighting"

	flaws = "nsfw, nude, lowres, bad quality, worst quality, worst detail, sketch, censor, jpeg artifacts, blurry, " +
		"bad anatomy, bad hands, extra fingers, missing fingers, fused fingers, extra digits, bad feet, " +
		"extra arms, extra legs, deformed, mutated, disfigured, long neck, " +
		"broken weapon, bent weapon, extra weapon, multiple weapons, dual wielding, floating weapon, " +
		"text, signature, watermark, logo, username"
	// Effects and harsh lighting are banned from every pass, crops included:
	// a detail pass at moderate strength will happily paint sparkles back in.
	effects = "sparkle, light particles, glowing, glint, lens flare, light rays, magic, aura, energy, " +
		"fire, flame, embers, lightning, electricity, smoke, petals, cherry blossoms, bubbles, snowflakes, water, " +
		"high contrast, harsh shadows, dark, dim lighting, backlighting, dramatic lighting, rim lighting, chiaroscuro, " +
		"oversaturated, neon, chromatic aberration, depth of field"
	detailNegative = flaws + ", " + effects
	// The full-body render additionally fights the ways a figure leaves the
	// frame, extra figures, scenery, and the ship rigging the model cannot draw.
	negative = detailNegative + ", " +
		"cropped, out of frame, head out of frame, feet out of frame, close-up, upper body, cowboy shot, portrait, " +
		"multiple girls, 2girls, multiple views, reference sheet, " +
		"scenery, detailed background, gradient background, sky, moon, stars, clouds, night, " +
		"rigging, turret, cannon, machinery, mecha musume, mechanical parts"
)

func buildJob(c meta.Card, d design) job {
	pose := d.Pose
	if !strings.Contains(pose, "standing") {
		pose = "standing, " + pose
	}
	var require, expect []string
	for t := range strings.SplitSeq(d.Check, ",") {
		t = strings.ReplaceAll(strings.TrimSpace(t), " ", "_")
		switch {
		case t == "":
		case strings.HasSuffix(t, "_hair"):
			require = append(append(require, t), similarHair[t]...)
		default:
			expect = append(expect, t)
		}
	}
	return job{
		ID:   c.ID,
		Name: c.Name,
		Seed: cardSeed(c.ID),
		Prompt: tags(
			quality,
			"1girl, solo, original",
			d.Hair, d.Eyes, d.Face, d.Head, d.Outfit, d.Trim, rarityFinish[c.Rarity], d.Hands, d.Legs, d.Item,
			pose, "full body, looking at viewer",
			"beautiful detailed eyes, detailed clothes",
			style,
			background(d),
		),
		Negative:       negative,
		DetailNegative: detailNegative,
		FacePrompt: tags(
			quality,
			"1girl, solo, face focus",
			d.Hair, d.Eyes, d.Face, d.Head,
			"beautiful detailed eyes, detailed face, perfect face",
			style,
		),
		HandPrompt: tags(
			quality,
			"hand focus",
			d.Hands, d.Item, d.Outfit,
			"detailed hands, perfect hands, five fingers",
			style,
		),
		// A tile shows a piece of the costume or the weapon, rarely the face:
		// no "1girl", which would invite a face into every tile.
		TilePrompt: tags(
			quality,
			d.Outfit, d.Trim, rarityFinish[c.Rarity], d.Hands, d.Legs, d.Item, d.Hair,
			"detailed clothes",
			style,
		),
		Require: require,
		Expect:  expect,
	}
}

// similarHair lists the colours the tagger may name a hair colour by; a
// render is only rejected for hair of a clearly different colour.
var similarHair = map[string][]string{
	"white_hair":      {"grey_hair"},
	"grey_hair":       {"white_hair"},
	"blue_hair":       {"light_blue_hair"},
	"light_blue_hair": {"blue_hair", "white_hair"},
	"aqua_hair":       {"green_hair", "blue_hair"},
	"green_hair":      {"aqua_hair"},
	"red_hair":        {"orange_hair"},
	"orange_hair":     {"red_hair"},
	"brown_hair":      {"light_brown_hair", "orange_hair"},
	"blonde_hair":     {"light_brown_hair"},
	"pink_hair":       {"red_hair"},
	"purple_hair":     {"blue_hair"},
}

// background picks a plain background the figure stands out from, so the
// segmenter separates them cleanly: white, or light grey behind pale hair.
func background(d design) string {
	for _, pale := range []string{"white hair", "grey hair", "silver hair"} {
		if strings.Contains(d.Hair, pale) {
			return "grey background, simple background"
		}
	}
	return "white background, simple background"
}

// tags joins tag groups, dropping empty groups and repeated tags.
func tags(groups ...string) string {
	var out []string
	for _, g := range groups {
		for t := range strings.SplitSeq(g, ",") {
			if t = strings.TrimSpace(t); t != "" && !slices.Contains(out, t) {
				out = append(out, t)
			}
		}
	}
	return strings.Join(out, ", ")
}

// Stable per-card seed so reruns reproduce the same candidates.
func cardSeed(id string) int {
	h := fnv.New32a()
	h.Write([]byte(id))
	return int(h.Sum32()%1_000_000) * 100 // leaves room for per-candidate offsets
}

func buildJobs(only []string) ([]job, error) {
	for _, id := range only {
		if _, ok := meta.CardByID(id); !ok {
			return nil, fmt.Errorf("unknown card id %q", id)
		}
	}
	var jobs []job
	for _, c := range meta.Cards {
		if len(only) > 0 && !slices.Contains(only, c.ID) {
			continue
		}
		d, ok := designs[c.ID]
		if !ok {
			return nil, fmt.Errorf("%s has no character sheet in characters.go", c.ID)
		}
		jobs = append(jobs, buildJob(c, d))
	}
	return jobs, nil
}

// ---- kit ----

func kitCmd(args []string) error {
	fs := flag.NewFlagSet("kit", flag.ExitOnError)
	out := fs.String("out", "../.cache/portraits/kit.zip", "output zip")
	only := fs.String("only", "", "comma-separated card ids (default: all)")
	src := fs.String("src", "../tools/portraitgen", "generator package")
	fs.Parse(args)

	var ids []string
	if *only != "" {
		ids = strings.Split(*only, ",")
	}
	jobs, err := buildJobs(ids)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		return err
	}
	f, err := os.Create(*out)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	if err := addPackage(zw, *src); err != nil {
		return err
	}
	w, err := zw.Create("jobs.json")
	if err != nil {
		return err
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(map[string]any{"jobs": jobs}); err != nil {
		return err
	}
	if err := zw.Close(); err != nil {
		return err
	}
	log.Printf("%d card(s) -> %s; upload it to tools/portraitgen/colab.ipynb", len(jobs), *out)
	return nil
}

// addPackage copies the installable parts of the Python project into the zip.
func addPackage(zw *zip.Writer, root string) error {
	files := []string{"pyproject.toml"}
	err := filepath.WalkDir(filepath.Join(root, "portraitgen"), func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && strings.HasSuffix(p, ".py") {
			rel, _ := filepath.Rel(root, p)
			files = append(files, rel)
		}
		return nil
	})
	if err != nil {
		return err
	}
	for _, rel := range files {
		data, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return err
		}
		w, err := zw.Create(filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		if _, err := w.Write(data); err != nil {
			return err
		}
	}
	return nil
}

// ---- import ----

// Portrait is one entry of frontend/public/portraits/manifest.json.
type Portrait struct {
	File string `json:"file"` // relative to the manifest, with a cache-busting query
	W    int    `json:"w"`
	H    int    `json:"h"`
	// Face box as fractions of the image (x0, y0, x1, y1), used to frame
	// busts on cards and faces on map tokens.
	Face []float64 `json:"face"`
}

type manifest struct {
	Version   int                 `json:"version"`
	Portraits map[string]Portrait `json:"portraits"`
}

const manifestVersion = 2

func importCmd(args []string) error {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	dir := fs.String("dir", "../frontend/public/portraits", "frontend portrait directory")
	fs.Parse(args)
	if fs.NArg() != 1 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	n, err := install(fs.Arg(0), *dir)
	if err != nil {
		return err
	}
	log.Printf("installed %d portrait(s) into %s", n, *dir)
	return nil
}

func install(zipPath, dir string) (int, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return 0, err
	}
	defer zr.Close()

	var info map[string]struct {
		W, H int
		Face []float64
	}
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		name := path.Base(f.Name)
		if name == "portraits.json" {
			if err := readJSON(f, &info); err != nil {
				return 0, fmt.Errorf("portraits.json: %w", err)
			}
		} else if id, ok := strings.CutSuffix(name, ".webp"); ok {
			files[id] = f
		}
	}
	if info == nil {
		return 0, fmt.Errorf("%s has no portraits.json; is it the notebook's portraits.zip?", zipPath)
	}

	if err := os.MkdirAll(dir, 0o755); err != nil {
		return 0, err
	}
	m := readManifest(dir)
	n := 0
	for id, f := range files {
		if _, ok := meta.CardByID(id); !ok {
			log.Printf("skip %s: not a card id", f.Name)
			continue
		}
		p, ok := info[id]
		if !ok {
			log.Printf("skip %s: missing from portraits.json", f.Name)
			continue
		}
		sum, err := extract(f, filepath.Join(dir, id+".webp"))
		if err != nil {
			return n, err
		}
		m.Portraits[id] = Portrait{File: id + ".webp?v=" + sum[:10], W: p.W, H: p.H, Face: p.Face}
		n++
	}
	return n, writeManifest(dir, m)
}

func readJSON(f *zip.File, v any) error {
	r, err := f.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	return json.NewDecoder(r).Decode(v)
}

// readManifest keeps earlier imports whose files are still there, so cards
// can be regenerated a few at a time.
func readManifest(dir string) manifest {
	m := manifest{Version: manifestVersion, Portraits: map[string]Portrait{}}
	var old manifest
	if buf, err := os.ReadFile(filepath.Join(dir, "manifest.json")); err == nil && json.Unmarshal(buf, &old) == nil && old.Version == manifestVersion {
		for id, p := range old.Portraits {
			file, _, _ := strings.Cut(p.File, "?")
			if _, err := os.Stat(filepath.Join(dir, file)); err == nil {
				m.Portraits[id] = p
			}
		}
	}
	return m
}

func writeManifest(dir string, m manifest) error {
	buf, _ := json.MarshalIndent(m, "", "  ")
	log.Printf("manifest: %d portrait(s)", len(m.Portraits))
	return os.WriteFile(filepath.Join(dir, "manifest.json"), append(buf, '\n'), 0o644)
}

// extract writes f to dst and returns the hex SHA-256 of its content.
func extract(f *zip.File, dst string) (string, error) {
	src, err := f.Open()
	if err != nil {
		return "", err
	}
	defer src.Close()
	out, err := os.Create(dst)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	if _, err := io.Copy(io.MultiWriter(out, h), src); err != nil {
		out.Close()
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), out.Close()
}
