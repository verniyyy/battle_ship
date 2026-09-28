// Command portraits is the local half of the character-art pipeline. The
// images themselves are generated on a free Google Colab GPU with an anime
// model from Hugging Face (scripts/portraits_colab.ipynb); this command
// prepares the prompts for it and installs what it produces.
//
//	go run ./cmd/portraits prompts                     # -> ../.cache/portraits/prompts.json
//	go run ./cmd/portraits prompts -only bb_guren -seed 7
//	go run ./cmd/portraits import ~/Downloads/portraits.zip
//
// import copies the cut-out <card id>.png files from the notebook's zip into
// frontend/public/portraits and rewrites manifest.json there, which the
// frontend uses to detect them. Without a zip it only rewrites the manifest,
// e.g. after placing hand-made art there.
package main

import (
	"archive/zip"
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

const usage = `usage:
  portraits prompts [-out file] [-only ids] [-seed n]   write prompts for the Colab notebook
  portraits import  [-dir dir] [portraits.zip]          install the notebook's output
                                                       (no zip: just rebuild manifest.json)
`

func main() {
	log.SetFlags(0)
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	switch cmd, args := os.Args[1], os.Args[2:]; cmd {
	case "prompts":
		prompts(args)
	case "import":
		importZip(args)
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
}

// ---- prompts ----

type job struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Prompt   string `json:"prompt"`
	Negative string `json:"negative"`
	Seed     int    `json:"seed"`
}

func prompts(args []string) {
	fs := flag.NewFlagSet("prompts", flag.ExitOnError)
	out := fs.String("out", "../.cache/portraits/prompts.json", "output file (- for stdout)")
	only := fs.String("only", "", "comma-separated card ids (default: all)")
	seed := fs.Int("seed", 0, "added to each card's seed; change it to reroll")
	fs.Parse(args)

	var want []string
	if *only != "" {
		want = strings.Split(*only, ",")
		for _, id := range want {
			if _, ok := meta.CardByID(id); !ok {
				log.Fatalf("unknown card id %q", id)
			}
		}
	}
	jobs := []job{}
	for _, c := range meta.Cards {
		if want != nil && !slices.Contains(want, c.ID) {
			continue
		}
		if cardMotif[c.ID] == "" {
			log.Printf("warning: %s has no cardMotif; its portrait will look generic", c.ID)
		}
		jobs = append(jobs, job{ID: c.ID, Name: c.Name, Prompt: promptFor(c), Negative: negativePrompt, Seed: cardSeed(c.ID) + *seed})
	}
	buf, _ := json.MarshalIndent(jobs, "", "  ")
	buf = append(buf, '\n')
	if *out == "-" {
		os.Stdout.Write(buf)
		return
	}
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(*out, buf, 0o644); err != nil {
		log.Fatal(err)
	}
	log.Printf("%d prompt(s) -> %s; upload it to scripts/portraits_colab.ipynb", len(jobs), *out)
}

// The prompts use Danbooru tags, which anime SDXL models such as Animagine
// XL and Illustrious are trained on: subject first, then details, then the
// quality tags. The look aims at the "ship girl" style of the legacy art.

var classMotif = map[game.ShipClass]string{
	game.Battleship: "large rigging on back, twin gun turrets, big cannons, machinery, military uniform, thighhighs",
	game.Cruiser:    "rigging, gun turret, searchlight, machinery, military uniform, pleated skirt",
	game.Destroyer:  "small rigging, torpedo tubes, holding gun, serafuku, sailor collar, pleated skirt, petite",
	game.Submarine:  "hooded jacket, sailor collar, school swimsuit, holding torpedo, wet hair",
	game.Carrier:    "archery, holding bow (weapon), yugake, flight deck on arm, muneate, japanese clothes, hakama skirt",
}

// A few tags of personality per card so cards of one class look distinct.
var cardMotif = map[string]string{
	"bb_kurogane":  "short hair, grey hair, grey eyes, expressionless, holding shield, arms crossed",
	"bb_tsurugi":   "long hair, ponytail, blue hair, blue eyes, serious, katana, sheathed, hand on hilt",
	"bb_guren":     "long hair, red hair, orange eyes, grin, fang, v, fire, red jacket",
	"bb_amaterasu": "very long hair, blonde hair, yellow eyes, gentle smile, halo, sun, white and gold dress, ornate armor",
	"bb_susanoo":   "long hair, purple hair, purple eyes, confident, long coat, lightning, electricity, storm",
	"ca_shirasagi": "long hair, white hair, pale blue eyes, gentle smile, feather hair ornament, white capelet",
	"ca_soyo":      "short hair, blue hair, sharp eyes, blue eyes, feathers, blue jacket",
	"ca_raimei":    "twintails, yellow hair, yellow eyes, open mouth smile, lightning bolt hair ornament",
	"ca_tsukuyomi": "very long hair, silver hair, purple eyes, crescent hair ornament, night sky cape, mysterious, half-closed eyes",
	"dd_asanagi":   "short hair, green hair, green eyes, holding binoculars, calm",
	"dd_hayate":    "short hair, aqua hair, aqua eyes, tomboy, grin, scarf, wind",
	"dd_byakuya":   "long hair, white hair, red eyes, elegant, hair ribbon, black serafuku",
	"dd_kagura":    "long hair, pink hair, pink eyes, smile, miko, kagura suzu, ribbons, dancing",
	"ss_senryu":    "short hair, dark blue hair, gold eyes, serious, dragon print",
	"ss_miyuki":    "medium hair, light blue hair, blue eyes, shy, blush, snowflake hair ornament",
	"ss_kaien":     "short hair, aqua hair, green eyes, smile, one eye closed, electricity",
	"ss_ryugu":     "long hair, pink hair, pink eyes, tiara, pearl necklace, coral, jellyfish, princess",
	"cv_kosame":    "short hair, light orange hair, brown eyes, gentle smile, holding umbrella, raindrops",
	"cv_hoyoku":    "side ponytail, orange hair, orange eyes, confident, smug",
	"cv_amagi":     "very long hair, orange hair, brown eyes, mature female, gentle smile, hair ornament",
	"cv_houou":     "long hair, red hair, gold eyes, phoenix, fire wings, red and gold kimono",
	"cv_amawashi":  "very long hair, white hair, aqua eyes, crown, feathered wings, white and aqua dress, regal",
}

var rarityFlavor = []string{
	"",
	"detailed clothes",
	"detailed clothes, glowing, sparkle",
	"ornate clothes, glowing, sparkle, aura",
	"ornate clothes, glowing, sparkle, aura, light particles",
}

func promptFor(c meta.Card) string {
	parts := []string{
		"1girl, solo, original, full body, standing, looking at viewer",
		cardMotif[c.ID],
		classMotif[c.Class],
		colorName(c.Color) + " theme",
		rarityFlavor[c.Rarity],
		"white background, simple background, safe",
		"masterpiece, best quality, high score, great score, absurdres",
	}
	return strings.Join(slices.DeleteFunc(parts, func(s string) bool { return s == "" }), ", ")
}

const negativePrompt = "nsfw, lowres, bad anatomy, bad hands, text, error, missing fingers, extra digits, fewer digits, cropped, out of frame, worst quality, low quality, low score, bad score, average score, signature, watermark, username, blurry, multiple girls, scenery, detailed background"

// colorName turns a card colour into a word the model understands.
func colorName(hex string) string {
	var r, g, b int
	fmt.Sscanf(strings.TrimPrefix(hex, "#"), "%02x%02x%02x", &r, &g, &b)
	mx, mn := max(r, g, b), min(r, g, b)
	if mx-mn < 40 {
		if mx > 200 {
			return "white"
		}
		return "grey"
	}
	var h float64
	d := float64(mx - mn)
	switch mx {
	case r:
		h = 60 * float64(g-b) / d
	case g:
		h = 60 * (2 + float64(b-r)/d)
	default:
		h = 60 * (4 + float64(r-g)/d)
	}
	if h < 0 {
		h += 360
	}
	names := []struct {
		upTo float64
		name string
	}{{15, "red"}, {40, "orange"}, {65, "yellow"}, {160, "green"}, {195, "aqua"}, {250, "blue"}, {290, "purple"}, {340, "pink"}, {360, "red"}}
	for _, n := range names {
		if h < n.upTo {
			return n.name
		}
	}
	return "red"
}

// Stable per-card seed so reruns reproduce the same character.
func cardSeed(id string) int {
	h := fnv.New32a()
	h.Write([]byte(id))
	return int(h.Sum32() % 1_000_000)
}

// ---- import ----

func importZip(args []string) {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	dir := fs.String("dir", "../frontend/public/portraits", "frontend portrait directory")
	fs.Parse(args)
	if fs.NArg() > 1 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	if fs.NArg() == 0 {
		if err := writeManifest(*dir); err != nil {
			log.Fatal(err)
		}
		return
	}
	zr, err := zip.OpenReader(fs.Arg(0))
	if err != nil {
		log.Fatal(err)
	}
	defer zr.Close()
	if err := os.MkdirAll(*dir, 0o755); err != nil {
		log.Fatal(err)
	}

	n := 0
	for _, f := range zr.File {
		id, ok := strings.CutSuffix(path.Base(f.Name), ".png")
		if !ok || f.FileInfo().IsDir() {
			continue
		}
		if _, known := meta.CardByID(id); !known {
			log.Printf("skip %s: not a card id", f.Name)
			continue
		}
		if err := extract(f, filepath.Join(*dir, id+".png")); err != nil {
			log.Fatal(err)
		}
		n++
	}
	log.Printf("installed %d portrait(s) into %s", n, *dir)
	if err := writeManifest(*dir); err != nil {
		log.Fatal(err)
	}
}

func extract(f *zip.File, dst string) error {
	src, err := f.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, src); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// writeManifest lists every card that has a portrait in dir, including ones
// placed there by hand.
func writeManifest(dir string) error {
	cards := []string{}
	for _, c := range meta.Cards {
		if _, err := os.Stat(filepath.Join(dir, c.ID+".png")); err == nil {
			cards = append(cards, c.ID)
		}
	}
	slices.Sort(cards)
	buf, _ := json.MarshalIndent(map[string]any{"version": 1, "cards": cards}, "", "  ")
	log.Printf("manifest: %d portrait(s)", len(cards))
	return os.WriteFile(filepath.Join(dir, "manifest.json"), append(buf, '\n'), 0o644)
}
