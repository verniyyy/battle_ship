package main

// design is a character sheet written in Danbooru tags, the vocabulary the
// Illustrious family of anime models is trained on. Each field is a group of
// comma-separated tags; they are split so the detail passes (face, hands,
// clothing tiles) can be prompted with just what is visible in their crops.
//
// The sheets follow a few rules, each learned from a failed generation:
//
//   - The character is the whole picture. No ship rigging (turrets and
//     machinery come out as mangled scrap at this scale), no effects
//     (lightning, flames, sparkles, petals) and nothing in the background
//     (moons, skies); the fleet identity lives in the costume instead:
//     naval uniforms, sailor collars, anchor emblems, gold braid.
//   - One signature item per character, of a shape the model draws reliably
//     (a sword, a spear, a bow, an umbrella, a lantern), held in a pose it
//     knows well, so hands and weapon stay intact.
//   - A clear palette of two or three colours, repeated from hair to shoes,
//     the way gacha character designs read at a glance.
type design struct {
	Hair   string // colour first (it is checked), then length and style
	Eyes   string
	Face   string // expression and facial accents
	Head   string // hair ornaments and headwear
	Outfit string // clothes, top to hem
	Trim   string // details and naval motifs on the clothes
	Hands  string // gloves and bracelets
	Legs   string // legwear and footwear: naming them keeps the feet in frame
	Item   string // the signature item and how it is held
	Pose   string
	// Check lists tags the tagger (SmilingWolf/wd-swinv2-tagger-v3) must see
	// in a good render: the hair colour and the item. Only tags from its
	// vocabulary work here, e.g. "sword" rather than "broadsword".
	Check string
}

// Rarity dresses the costume up; the card frame does the rest. Deliberately
// no "glowing" or "divine": those summon light effects.
var rarityFinish = []string{
	"",
	"detailed clothes",
	"detailed clothes, gold trim",
	"intricate clothes, gold trim, jewelry",
	"intricate clothes, ornate clothes, gold trim, jewelry, gem",
}

var designs = map[string]design{
	// ---- battleships: armoured, regal, heavy weapons ----
	"bb_kurogane": { // 黒鉄 鋼の守り手 steel grey, black, silver
		Hair:   "grey hair, long hair, straight hair, sidelocks, hair between eyes",
		Eyes:   "grey eyes",
		Face:   "calm, closed mouth, light smile",
		Head:   "black hair ribbon, anchor hair ornament",
		Outfit: "black military uniform, double-breasted, high collar, black pleated skirt, belt",
		Trim:   "silver buttons, epaulettes, shoulder armor, silver trim, anchor symbol",
		Hands:  "white gloves",
		Legs:   "black pantyhose, black knee boots",
		Item:   "holding shield, large shield, silver shield",
		Pose:   "standing, holding shield",
		Check:  "grey hair, shield",
	},
	"bb_tsurugi": { // 剣峰 不屈の砲座 navy blue, white
		Hair:   "blue hair, long hair, high ponytail, sidelocks",
		Eyes:   "blue eyes, sharp eyes",
		Face:   "serious, closed mouth",
		Head:   "white hair ribbon",
		Outfit: "navy blue coat, long coat, military uniform, white shirt, black necktie, black pleated skirt, belt",
		Trim:   "gold buttons, aiguillette, epaulettes, anchor symbol",
		Hands:  "white gloves",
		Legs:   "white thighhighs, brown knee boots",
		Item:   "planted sword, hands on hilt, sword",
		Pose:   "standing, planted sword, hands on hilt",
		Check:  "blue hair, sword",
	},
	"bb_guren": { // 紅蓮 燃え盛る主砲 crimson, black, gold
		Hair:   "red hair, long hair, messy hair, ahoge",
		Eyes:   "orange eyes",
		Face:   "grin, fang, confident",
		Head:   "goggles on head",
		Outfit: "red military jacket, cropped jacket, open jacket, black crop top, black shorts, belt, midriff",
		Trim:   "gold trim, epaulettes, gold buttons",
		Hands:  "black fingerless gloves",
		Legs:   "red thighhighs, black combat boots",
		Item:   "holding sword, greatsword, weapon over shoulder",
		Pose:   "standing, weapon over shoulder, hand on own hip",
		Check:  "red hair, sword",
	},
	"bb_amaterasu": { // 天照 日輪の戦姫 white, gold
		Hair:   "blonde hair, very long hair, wavy hair",
		Eyes:   "yellow eyes",
		Face:   "gentle smile, closed mouth",
		Head:   "gold circlet, hair ornament",
		Outfit: "white dress, long dress, breastplate, gold armor, shoulder armor, detached sleeves, wide sleeves",
		Trim:   "gold trim, white cape",
		Hands:  "white gloves",
		Legs:   "white thighhighs, gold high heels",
		Item:   "holding polearm, spear, gold spear",
		Pose:   "standing, holding polearm",
		Check:  "blonde hair, polearm",
	},
	"bb_susanoo": { // 須佐之男 嵐を統べる者 black, violet, gold
		Hair:   "purple hair, very long hair, messy hair",
		Eyes:   "purple eyes",
		Face:   "smirk, confident",
		Head:   "hair ornament, tassel earrings",
		Outfit: "black coat, coat on shoulders, black dress, high collar, sash",
		Trim:   "purple trim, gold trim, tassel, gold buttons",
		Hands:  "black gloves",
		Legs:   "black thigh boots",
		Item:   "holding katana, sheathed",
		Pose:   "standing, holding katana, hand on own hip",
		Check:  "purple hair, katana",
	},

	// ---- cruisers: sharp, agile, one tool each ----
	"ca_shirasagi": { // 白鷺 夜を照らす翼 white, pale blue
		Hair:   "white hair, long hair, straight hair, blunt bangs",
		Eyes:   "light blue eyes",
		Face:   "gentle smile, closed mouth",
		Head:   "white feather hair ornament",
		Outfit: "white capelet, white sailor dress, blue sailor collar, blue neckerchief, long sleeves",
		Trim:   "anchor symbol, gold buttons",
		Hands:  "white gloves",
		Legs:   "white thighhighs, brown loafers",
		Item:   "holding lantern",
		Pose:   "standing, holding lantern",
		Check:  "white hair, lantern",
	},
	"ca_soyo": { // 蒼鷹 蒼穹の狩人 sky blue, white, brown
		Hair:   "blue hair, short hair, asymmetrical bangs",
		Eyes:   "light blue eyes, sharp eyes",
		Face:   "confident, light smile",
		Head:   "blue beret, feather hair ornament",
		Outfit: "blue jacket, cropped jacket, white shirt, black shorts, belt, thigh strap",
		Trim:   "fur-trimmed collar, epaulettes, anchor symbol",
		Hands:  "brown gloves",
		Legs:   "black knee boots",
		Item:   "holding rifle, rifle, weapon over shoulder",
		Pose:   "standing, weapon over shoulder",
		Check:  "blue hair, rifle",
	},
	"ca_raimei": { // 雷鳴 轟く閃光 yellow, black
		Hair:   "blonde hair, twintails, long hair",
		Eyes:   "yellow eyes",
		Face:   "open mouth, smile, fang, excited",
		Head:   "hairclip, black hairclip",
		Outfit: "yellow and black jacket, cropped jacket, black crop top, black pleated miniskirt, belt",
		Trim:   "yellow trim, zipper",
		Hands:  "black fingerless gloves",
		Legs:   "striped thighhighs, yellow sneakers",
		Item:   "holding hammer, war hammer, weapon over shoulder",
		Pose:   "standing, weapon over shoulder, hand on own hip",
		Check:  "blonde hair, hammer",
	},
	"ca_tsukuyomi": { // 月詠 静寂の月光 midnight blue, silver
		Hair:   "white hair, very long hair, hime cut",
		Eyes:   "purple eyes, half-closed eyes",
		Face:   "light smile, closed mouth",
		Head:   "crescent hair ornament, hair flower",
		Outfit: "dark blue kimono, long kimono, wide sleeves, obi, see-through shawl",
		Trim:   "silver trim, obijime",
		Hands:  "",
		Legs:   "white tabi, zouri",
		Item:   "holding folding fan",
		Pose:   "standing, holding folding fan",
		Check:  "white hair, folding fan",
	},

	// ---- destroyers: young, light, lively ----
	"dd_asanagi": { // 朝凪 凪の見張り番 mint green, white
		Hair:   "green hair, short hair, bob cut",
		Eyes:   "green eyes",
		Face:   "calm, light smile",
		Head:   "headphones",
		Outfit: "serafuku, white shirt, green sailor collar, green neckerchief, green pleated skirt",
		Trim:   "anchor symbol",
		Hands:  "",
		Legs:   "black kneehighs, brown loafers",
		Item:   "holding binoculars",
		Pose:   "standing, holding binoculars",
		Check:  "green hair, binoculars",
	},
	"dd_hayate": { // 疾風 風より速く aqua, white, navy
		Hair:   "aqua hair, short hair, spiked hair",
		Eyes:   "aqua eyes",
		Face:   "grin, bandaid on cheek",
		Head:   "goggles on head",
		Outfit: "blue track jacket, open jacket, white shirt, sailor collar, navy blue shorts, long scarf, white scarf",
		Trim:   "anchor symbol",
		Hands:  "fingerless gloves",
		Legs:   "white socks, sneakers",
		Item:   "thumbs up",
		Pose:   "standing, thumbs up, hand on own hip",
		Check:  "aqua hair",
	},
	"dd_byakuya": { // 白夜 沈まぬ太陽 white, black, red
		Hair:   "white hair, long hair, straight hair",
		Eyes:   "red eyes",
		Face:   "expressionless, closed mouth",
		Head:   "black hair ribbon",
		Outfit: "black serafuku, red neckerchief, black pleated skirt",
		Trim:   "white sailor collar, red trim",
		Hands:  "white gloves",
		Legs:   "black pantyhose, black mary janes",
		Item:   "holding umbrella, parasol, black umbrella, frilled umbrella",
		Pose:   "standing, holding umbrella",
		Check:  "white hair, umbrella",
	},
	"dd_kagura": { // 神楽 舞い踊る刃 pink, white, red
		Hair:   "pink hair, long hair, low twintails",
		Eyes:   "pink eyes",
		Face:   "smile, closed mouth",
		Head:   "hair ribbon, hair flower",
		Outfit: "miko, white kimono, pink hakama skirt, wide sleeves",
		Trim:   "ribbon trim, red ribbon",
		Hands:  "",
		Legs:   "white tabi, geta",
		Item:   "holding naginata, naginata",
		Pose:   "standing, holding naginata",
		Check:  "pink hair, naginata",
	},

	// ---- submarines: swimsuits and jackets, playful ----
	"ss_senryu": { // 潜龍 深き海の牙 dark blue, yellow
		Hair:   "blue hair, dark blue hair, short hair, hair between eyes",
		Eyes:   "yellow eyes",
		Face:   "light smile, closed mouth",
		Head:   "hood down",
		Outfit: "school swimsuit, hooded jacket, open jacket, sailor collar",
		Trim:   "yellow trim, zipper",
		Hands:  "",
		Legs:   "white socks, sneakers",
		Item:   "holding torpedo, torpedo",
		Pose:   "standing, holding torpedo",
		Check:  "blue hair, torpedo",
	},
	"ss_miyuki": { // 深雪 静かなる白 pale blue, white
		Hair:   "light blue hair, medium hair",
		Eyes:   "blue eyes",
		Face:   "shy, blush, closed mouth",
		Head:   "snowflake hair ornament",
		Outfit: "oversized white hoodie, school swimsuit, sleeves past wrists",
		Trim:   "fur trim",
		Hands:  "",
		Legs:   "white thighhighs, white boots",
		Item:   "hugging object, torpedo",
		Pose:   "standing, hugging object",
		Check:  "light blue hair, torpedo",
	},
	"ss_kaien": { // 海燕 波間の稲妻 teal, navy, white
		Hair:   "aqua hair, short hair, messy hair",
		Eyes:   "green eyes",
		Face:   "grin, one eye closed",
		Head:   "goggles on head",
		Outfit: "competition swimsuit, navy blue jacket, open jacket",
		Trim:   "white trim, emblem",
		Hands:  "fingerless gloves",
		Legs:   "sneakers",
		Item:   "holding trident, trident",
		Pose:   "standing, holding trident",
		Check:  "aqua hair, trident",
	},
	"ss_ryugu": { // 竜宮 海底の姫君 coral pink, pearl white
		Hair:   "pink hair, very long hair, wavy hair",
		Eyes:   "pink eyes",
		Face:   "light smile, half-closed eyes",
		Head:   "tiara, pearl hair ornament",
		Outfit: "pink and white dress, frilled dress, see-through sleeves",
		Trim:   "pearl necklace, gold trim",
		Hands:  "",
		Legs:   "white high heels",
		Item:   "holding box, ornate box",
		Pose:   "standing, holding box",
		Check:  "pink hair, box",
	},

	// ---- carriers: archers in Japanese dress ----
	"cv_kosame": { // 小雨 雨上がりの翼 light brown, orange, white
		Hair:   "brown hair, light brown hair, short hair, side braid",
		Eyes:   "brown eyes",
		Face:   "gentle smile",
		Head:   "hair ornament",
		Outfit: "japanese clothes, white kimono, orange hakama skirt, muneate",
		Trim:   "orange trim",
		Hands:  "",
		Legs:   "white tabi, zouri",
		Item:   "holding umbrella, oil-paper umbrella",
		Pose:   "standing, holding umbrella",
		Check:  "brown hair, oil-paper umbrella",
	},
	"cv_hoyoku": { // 鳳翼 紅の飛行甲板 orange, red, white
		Hair:   "orange hair, long hair, side ponytail",
		Eyes:   "orange eyes",
		Face:   "smug, confident smile",
		Head:   "hair ribbon",
		Outfit: "japanese clothes, white kimono, red hakama skirt, muneate, detached sleeves",
		Trim:   "red trim",
		Hands:  "yugake",
		Legs:   "black thighhighs, zouri",
		Item:   "holding bow (weapon), yumi (bow)",
		Pose:   "standing, holding bow (weapon), hand on own hip",
		Check:  "orange hair, bow (weapon)",
	},
	"cv_amagi": { // 天城 天翔ける城 chestnut, amber
		Hair:   "brown hair, very long hair, low ponytail",
		Eyes:   "brown eyes",
		Face:   "gentle smile, mature female",
		Head:   "kanzashi, hair ornament",
		Outfit: "orange kimono, floral print, obi, long sleeves, muneate",
		Trim:   "gold trim",
		Hands:  "yugake",
		Legs:   "white tabi, zouri",
		Item:   "holding bow (weapon), yumi (bow)",
		Pose:   "standing, holding bow (weapon)",
		Check:  "brown hair, bow (weapon)",
	},
	"cv_houou": { // 鳳凰 不死の炎翼 crimson, gold
		Hair:   "red hair, long hair, gradient hair, orange hair",
		Eyes:   "yellow eyes",
		Face:   "confident smile",
		Head:   "feather hair ornament, gold hair ornament",
		Outfit: "red kimono, short kimono, obi, detached sleeves, wide sleeves",
		Trim:   "gold trim, feather trim",
		Hands:  "yugake",
		Legs:   "red thighhighs, geta",
		Item:   "holding bow (weapon), yumi (bow)",
		Pose:   "standing, holding bow (weapon)",
		Check:  "red hair, bow (weapon)",
	},
	"cv_amawashi": { // 天鷲 天空の覇者 white, aqua, gold
		Hair:   "white hair, very long hair, straight hair",
		Eyes:   "aqua eyes",
		Face:   "closed mouth, light smile",
		Head:   "crown",
		Outfit: "white dress, aqua trim, armored dress, shoulder armor, cape",
		Trim:   "gold trim, gem",
		Hands:  "gauntlets",
		Legs:   "armored boots",
		Item:   "holding bow (weapon)",
		Pose:   "standing, holding bow (weapon)",
		Check:  "white hair, bow (weapon)",
	},
}
