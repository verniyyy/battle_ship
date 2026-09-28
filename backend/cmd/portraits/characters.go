package main

import "github.com/verniyyy/battle_ship/backend/internal/game"

// design is a character sheet written in Danbooru tags, the vocabulary the
// Illustrious family of anime models is trained on. Each field is a group of
// comma-separated tags; they are split so the face and hand detail passes
// can be prompted with just the parts visible in their crops.
type design struct {
	Hair   string // colour, length, style
	Eyes   string
	Face   string // expression and facial accents
	Head   string // hair ornaments, hats, halos
	Outfit string // clothes above the knees
	Hands  string // gloves, bracelets and what the hands hold or do
	Legs   string // legwear and footwear: naming them keeps the feet in frame
	Gear   string // ship rigging and weapons
	Pose   string
	Aura   string // effects that belong to the character; kept close to the body
}

// Rigging shared by each ship class so the fleet reads as one world.
var classGear = map[game.ShipClass]string{
	game.Battleship: "mechanical rigging, large gun turrets, cannons, armor plates",
	game.Cruiser:    "mechanical rigging, gun turret, searchlight",
	game.Destroyer:  "small mechanical rigging, torpedo tubes, smokestack",
	game.Submarine:  "torpedo, small rigging",
	game.Carrier:    "flight deck, bow (weapon), arrow (projectile), quiver",
}

// Rarity dresses the art up; the card frame does the rest.
var rarityFinish = []string{
	"",
	"detailed clothes",
	"intricate clothes, gold trim",
	"ornate clothes, intricate details, gold trim, glowing",
	"ornate clothes, intricate details, gold trim, glowing, divine",
}

var designs = map[string]design{
	// ---- battleships ----
	"bb_kurogane": {
		Hair:   "grey hair, long hair, straight hair, sidelocks, hair between eyes",
		Eyes:   "grey eyes",
		Face:   "calm, closed mouth, light smile",
		Head:   "black hair ribbon",
		Outfit: "black military uniform, double-breasted, epaulettes, silver buttons, black pleated skirt, belt",
		Hands:  "white gloves, holding shield",
		Legs:   "black pantyhose, black knee boots",
		Gear:   "large shield, steel rigging on back, twin gun turrets",
		Pose:   "standing, straight-on",
	},
	"bb_tsurugi": {
		Hair:   "blue hair, long hair, high ponytail, sidelocks",
		Eyes:   "blue eyes, sharp eyes",
		Face:   "serious, closed mouth",
		Head:   "hair ribbon",
		Outfit: "navy blue military coat, white shirt, black necktie, pleated skirt, belt, sword at waist",
		Hands:  "black gloves, hand on hilt",
		Legs:   "white thighhighs, brown knee boots",
		Gear:   "katana, sheathed, rigging on back, triple gun turrets",
		Pose:   "standing, hand on hilt",
	},
	"bb_guren": {
		Hair:   "red hair, long hair, messy hair, ahoge",
		Eyes:   "orange eyes",
		Face:   "grin, fang, one eye closed, energetic",
		Head:   "goggles on head",
		Outfit: "red military jacket, open jacket, black crop top, black shorts, belt, midriff",
		Hands:  "fingerless gloves, v",
		Legs:   "red thighhighs, black combat boots",
		Gear:   "rigging on back, twin cannons, glowing red hot barrels",
		Pose:   "standing, leaning forward, v",
		Aura:   "embers",
	},
	"bb_amaterasu": {
		Hair:   "blonde hair, very long hair, wavy hair",
		Eyes:   "yellow eyes",
		Face:   "gentle smile, closed mouth",
		Head:   "halo, sun hair ornament, gold circlet",
		Outfit: "white and gold dress, shoulder armor, breastplate, detached sleeves, wide sleeves, sun emblem",
		Hands:  "white gloves, hand on own chest",
		Legs:   "white thighhighs, gold high heels",
		Gear:   "golden rigging, large gun turrets",
		Pose:   "standing, hand on own chest",
		Aura:   "light rays, sunlight",
	},
	"bb_susanoo": {
		Hair:   "purple hair, long hair, messy hair, streaked hair",
		Eyes:   "purple eyes, glowing eyes",
		Face:   "smirk, confident",
		Head:   "",
		Outfit: "black long coat, coat on shoulders, purple trim, black bodysuit, belt, tassel",
		Hands:  "armored gloves, clenched hand",
		Legs:   "black thigh boots",
		Gear:   "massive rigging on back, triple gun turrets, storm cloud motif",
		Pose:   "standing, hand on own hip",
		Aura:   "electricity, purple lightning",
	},

	// ---- cruisers ----
	"ca_shirasagi": {
		Hair:   "white hair, long hair, straight hair, blunt bangs",
		Eyes:   "light blue eyes",
		Face:   "gentle smile, closed mouth",
		Head:   "white feather hair ornament",
		Outfit: "white capelet, white sailor dress, blue neckerchief, long sleeves",
		Hands:  "white gloves, holding lantern",
		Legs:   "white thighhighs, brown loafers",
		Gear:   "rigging, gun turret, searchlight",
		Pose:   "standing, holding lantern",
		Aura:   "white feathers",
	},
	"ca_soyo": {
		Hair:   "blue hair, short hair, asymmetrical bangs",
		Eyes:   "light blue eyes, sharp eyes",
		Face:   "confident, light smile",
		Head:   "feather hair ornament, monocle",
		Outfit: "blue jacket, feather trim, fur collar, white shirt, black shorts, thigh strap",
		Hands:  "fingerless gloves, pointing",
		Legs:   "black knee boots",
		Gear:   "rigging, gun turret, rangefinder",
		Pose:   "standing, pointing forward",
	},
	"ca_raimei": {
		Hair:   "yellow hair, twintails, long hair",
		Eyes:   "yellow eyes",
		Face:   "open mouth, smile, fang, excited",
		Head:   "lightning bolt hair ornament",
		Outfit: "yellow and black jacket, cropped jacket, crop top, pleated miniskirt",
		Hands:  "fingerless gloves, clenched hands",
		Legs:   "striped thighhighs, yellow sneakers",
		Gear:   "rigging, twin gun turrets",
		Pose:   "standing, fighting stance",
		Aura:   "electricity, sparks",
	},
	"ca_tsukuyomi": {
		Hair:   "silver hair, very long hair, hime cut",
		Eyes:   "purple eyes, half-closed eyes",
		Face:   "light smile, mysterious",
		Head:   "crescent hair ornament, hair flower",
		Outfit: "dark blue kimono, starry sky print, wide sleeves, obi, see-through shawl, silver trim",
		Hands:  "holding folding fan",
		Legs:   "white tabi, zouri",
		Gear:   "rigging, gun turrets, crescent moon emblem",
		Pose:   "standing, holding folding fan",
		Aura:   "moonlight, sparkle",
	},

	// ---- destroyers ----
	"dd_asanagi": {
		Hair:   "mint green hair, short hair, bob cut",
		Eyes:   "green eyes",
		Face:   "calm, light smile",
		Head:   "headphones",
		Outfit: "serafuku, white shirt, green sailor collar, green neckerchief, green pleated skirt",
		Hands:  "holding binoculars",
		Legs:   "black kneehighs, brown loafers",
		Gear:   "small rigging on back, torpedo tubes",
		Pose:   "standing, holding binoculars",
	},
	"dd_hayate": {
		Hair:   "aqua hair, short hair, spiked hair",
		Eyes:   "aqua eyes",
		Face:   "grin, tomboy, bandaid on cheek",
		Head:   "goggles on head",
		Outfit: "sailor collar, blue track jacket, open jacket, white shirt, shorts, long scarf, scarf flowing",
		Hands:  "fingerless gloves, thumbs up",
		Legs:   "white socks, sneakers",
		Gear:   "small rigging, torpedo launcher",
		Pose:   "standing, thumbs up",
		Aura:   "wind",
	},
	"dd_byakuya": {
		Hair:   "white hair, long hair, straight hair",
		Eyes:   "red eyes",
		Face:   "expressionless, cool",
		Head:   "black hair ribbon",
		Outfit: "black serafuku, red neckerchief, black pleated skirt",
		Hands:  "white gloves, hand on own hip",
		Legs:   "black pantyhose, black mary janes",
		Gear:   "rigging, torpedo tubes",
		Pose:   "standing, hand on own hip",
	},
	"dd_kagura": {
		Hair:   "pink hair, long hair, low twintails",
		Eyes:   "pink eyes",
		Face:   "smile, one eye closed, open mouth",
		Head:   "hair ribbon, hair flower",
		Outfit: "miko, white kimono, pink hakama skirt, wide sleeves, ribbon trim",
		Hands:  "holding kagura suzu",
		Legs:   "white tabi, geta",
		Gear:   "small rigging, torpedo tubes",
		Pose:   "standing, dancing",
		Aura:   "cherry blossoms, ribbons",
	},

	// ---- submarines ----
	"ss_senryu": {
		Hair:   "dark blue hair, short hair, hair between eyes",
		Eyes:   "yellow eyes",
		Face:   "light smile, closed mouth",
		Head:   "hood down",
		Outfit: "school swimsuit, open hooded jacket, dragon print, sailor collar",
		Hands:  "holding torpedo",
		Legs:   "white socks, sneakers",
		Gear:   "dragon ornament",
		Pose:   "standing, holding torpedo",
	},
	"ss_miyuki": {
		Hair:   "light blue hair, medium hair",
		Eyes:   "blue eyes",
		Face:   "shy, blush, closed mouth",
		Head:   "snowflake hair ornament",
		Outfit: "oversized white hoodie, school swimsuit, sleeves past wrists",
		Hands:  "hugging object",
		Legs:   "white thighhighs, white boots",
		Gear:   "large torpedo",
		Pose:   "standing, hugging torpedo",
		Aura:   "snowflakes",
	},
	"ss_kaien": {
		Hair:   "aqua hair, short hair, messy hair",
		Eyes:   "green eyes",
		Face:   "grin, one eye closed",
		Head:   "goggles on head",
		Outfit: "competition swimsuit, open jacket, swallow emblem",
		Hands:  "fingerless gloves, pointing at viewer",
		Legs:   "sneakers",
		Gear:   "torpedo launcher on arm, torpedoes",
		Pose:   "standing, pointing at viewer",
	},
	"ss_ryugu": {
		Hair:   "pink hair, very long hair, wavy hair",
		Eyes:   "pink eyes",
		Face:   "seductive smile, half-closed eyes",
		Head:   "tiara, pearl hair ornament",
		Outfit: "pink and white dress, frilled dress, see-through sleeves, pearl necklace, jellyfish motif",
		Hands:  "holding box, ornate box",
		Legs:   "white high heels",
		Gear:   "torpedo, coral ornament",
		Pose:   "standing, holding box",
		Aura:   "bubbles, small jellyfish",
	},

	// ---- carriers ----
	"cv_kosame": {
		Hair:   "light brown hair, short hair, side braid",
		Eyes:   "brown eyes",
		Face:   "gentle smile",
		Head:   "raindrop hair ornament",
		Outfit: "japanese clothes, white kimono top, orange hakama skirt, muneate",
		Hands:  "yugake, holding bow (weapon)",
		Legs:   "white tabi, zouri",
		Gear:   "flight deck on arm",
		Pose:   "standing, holding bow (weapon)",
	},
	"cv_hoyoku": {
		Hair:   "orange hair, side ponytail, long hair",
		Eyes:   "orange eyes",
		Face:   "smug, confident smile",
		Head:   "hair ribbon",
		Outfit: "japanese clothes, red hakama skirt, muneate, detached sleeves",
		Hands:  "yugake, holding bow (weapon)",
		Legs:   "black thighhighs, zouri",
		Gear:   "flight deck on arm",
		Pose:   "standing, hand on own hip, holding bow (weapon)",
	},
	"cv_amagi": {
		Hair:   "brown hair, very long hair, low ponytail",
		Eyes:   "brown eyes",
		Face:   "gentle smile, mature female",
		Head:   "hair ornament, kanzashi",
		Outfit: "orange kimono, floral print, obi, long sleeves, muneate",
		Hands:  "holding bow (weapon)",
		Legs:   "white tabi, zouri",
		Gear:   "flight deck on arm",
		Pose:   "standing, holding bow (weapon)",
	},
	"cv_houou": {
		Hair:   "red hair, long hair, gradient hair, orange hair",
		Eyes:   "yellow eyes",
		Face:   "confident smile",
		Head:   "phoenix hair ornament",
		Outfit: "red and gold kimono, short kimono, feather trim, obi",
		Hands:  "holding bow (weapon)",
		Legs:   "red thighhighs, geta",
		Gear:   "flight deck on arm",
		Pose:   "standing, holding bow (weapon)",
		Aura:   "fire wings, flame, feathers",
	},
	"cv_amawashi": {
		Hair:   "white hair, very long hair, straight hair",
		Eyes:   "aqua eyes",
		Face:   "regal, closed mouth, light smile",
		Head:   "crown",
		Outfit: "white and aqua dress, ornate armor, cape, shoulder armor",
		Hands:  "armored gloves, holding bow (weapon)",
		Legs:   "armored boots",
		Gear:   "flight deck on arm",
		Pose:   "standing, holding bow (weapon)",
		Aura:   "feathered wings, white wings",
	},
}
