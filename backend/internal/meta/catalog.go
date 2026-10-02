// Package meta is the progression layer around battles: the ship card
// catalog, player profiles, gacha, the campaign, rewards and daily loops.
package meta

import (
	"fmt"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

type Rarity int

const (
	N Rarity = iota
	R
	SR
	SSR
	UR
)

var rarityNames = [...]string{"N", "R", "SR", "SSR", "UR"}

func (r Rarity) String() string { return rarityNames[r] }

// Card is a collectible ship. Stats are its level-1, unlimited-broken base.
//
// Rarity widens the numbers only modestly (UR is roughly a quarter stronger
// than N of the same class): a better card helps, but reading the sea wins
// battles.
type Card struct {
	ID     string         `json:"id"`
	Class  game.ShipClass `json:"class"`
	Name   string         `json:"name"`
	Title  string         `json:"title"`
	Rarity Rarity         `json:"rarity"`
	Color  string         `json:"color"`
	game.Stats
	// Lines: Intro when obtained, Attack for cut-ins, Home for the secretary.
	Intro  string   `json:"intro"`
	Attack string   `json:"attack"`
	Home   []string `json:"home"`
	// Fx names the motion effect played over the card's art on showcase
	// screens (the frontend's MotionFx presets); empty for none.
	Fx string `json:"fx,omitempty"`
}

var Cards = []Card{
	// ---- battleships: barrage ----
	{ID: "bb_kurogane", Class: game.Battleship, Name: "黒鉄", Title: "鋼の守り手", Rarity: N, Color: "#9fb0c8",
		Stats: st(640, 175, 0, 0, 38, 27, 10, 7, 0, 1, 6, 0),
		Intro: "戦艦、黒鉄。今日からあなたの盾になる。", Attack: "主砲、斉射！",
		Home: []string{"装甲の厚さなら誰にも負けない。", "焦らないで。砲撃は狙いが肝心。"}},
	{ID: "bb_tsurugi", Class: game.Battleship, Name: "剣峰", Title: "不屈の砲座", Rarity: R, Color: "#6fa8dc",
		Stats: st(650, 195, 0, 0, 42, 25, 11, 7, 0, 1, 9, 0),
		Intro: "剣峰、着任。この砲で道を切り拓こう。", Attack: "剣峰の砲、受けてみよ！",
		Home: []string{"一撃必中、それが私の流儀。", "提督、次の海域はどこだ？"}},
	{ID: "bb_guren", Class: game.Battleship, Name: "紅蓮", Title: "燃え盛る主砲", Rarity: SR, Color: "#ff6b4a",
		Stats: st(680, 215, 0, 0, 40, 24, 12, 7, 0, 2, 10, 0),
		Intro: "紅蓮だよ！ぜーんぶ燃やしちゃうからね！", Attack: "燃え尽きろぉっ！",
		Home: []string{"砲身が熱いうちに出撃しよ？", "爆発って、芸術だと思うんだ。"}},
	{ID: "bb_amaterasu", Class: game.Battleship, Name: "天照", Title: "日輪の戦姫", Rarity: SSR, Color: "#ffcf4a",
		Stats: st(720, 225, 0, 0, 55, 27, 13, 8, 0, 2, 11, 3),
		Intro: "我は天照。この海に、夜明けをもたらしましょう。", Attack: "日輪よ、敵を灼け！",
		Home: []string{"光ある限り、私たちは負けません。", "提督、あなたの采配を信じています。"}, Fx: "sun"},
	{ID: "bb_susanoo", Class: game.Battleship, Name: "須佐之男", Title: "嵐を統べる者", Rarity: UR, Color: "#b388ff",
		Stats: st(740, 240, 0, 0, 50, 28, 14, 8, 0, 2, 13, 3),
		Intro: "嵐と共に来たれり。須佐之男、推参！", Attack: "荒ぶる嵐よ、全てを呑め！",
		Home: []string{"退屈だ。もっと強い敵はいないのか？", "俺を使いこなせるか、提督。"}, Fx: "storm"},

	// ---- cruisers: flare ----
	{ID: "ca_shirasagi", Class: game.Cruiser, Name: "白鷺", Title: "夜を照らす翼", Rarity: N, Color: "#cfe8ff",
		Stats: st(400, 120, 180, 0, 50, 15, 22, 8, 2, 2, 7, 8),
		Intro: "巡洋艦、白鷺です。夜の海はお任せを。", Attack: "照準よし、撃てっ！",
		Home: []string{"照明弾なら、潜水艦以外は丸見えです。", "白い羽根、きれいでしょう？"}},
	{ID: "ca_soyo", Class: game.Cruiser, Name: "蒼鷹", Title: "蒼穹の狩人", Rarity: R, Color: "#4fc3f7",
		Stats: st(410, 130, 195, 0, 52, 15, 24, 8, 2, 2, 9, 10),
		Intro: "蒼鷹。獲物は逃がさない。", Attack: "見つけた……そこだ！",
		Home: []string{"索敵は狩りの基本だよ。", "鷹の目からは逃げられない。"}},
	{ID: "ca_raimei", Class: game.Cruiser, Name: "雷鳴", Title: "轟く閃光", Rarity: SR, Color: "#ffe14a",
		Stats: st(430, 140, 220, 0, 48, 14, 27, 8, 3, 2, 11, 12),
		Intro: "雷鳴参上！ビリビリいくよっ！", Attack: "ドカーンと一発！",
		Home: []string{"雷って速いんだよ？私も速いけど！", "ねえねえ、早く出撃しようよ！"}},
	{ID: "ca_tsukuyomi", Class: game.Cruiser, Name: "月詠", Title: "静寂の月光", Rarity: SSR, Color: "#9fa8ff",
		Stats: st(470, 150, 225, 0, 62, 16, 25, 9, 3, 3, 12, 12),
		Intro: "月詠と申します。月の光が、あなたを導きますように。", Attack: "月下に散りなさい。",
		Home: []string{"静かな夜ですね……嵐の前の。", "提督、少し休まれては？"}},

	// ---- destroyers: sonar ----
	{ID: "dd_asanagi", Class: game.Destroyer, Name: "朝凪", Title: "凪の見張り番", Rarity: N, Color: "#7fe0c0",
		Stats: st(240, 78, 240, 0, 26, 5, 32, 7, 3, 2, 7, 16),
		Intro: "駆逐艦、朝凪。よろしくね、司令官。", Attack: "逃がさないよ！",
		Home: []string{"ソナーなら潜水艦だって見つけられる。", "小さいけど、すばしっこいんだ。"}},
	{ID: "dd_hayate", Class: game.Destroyer, Name: "疾風", Title: "風より速く", Rarity: R, Color: "#6ee7ff",
		Stats: st(245, 82, 250, 0, 24, 4, 38, 7, 3, 2, 8, 22),
		Intro: "疾風！どんな砲弾も当たらないぜ！", Attack: "一気に決めるっ！",
		Home: []string{"遅い遅い！", "回避なら任せとけ！"}},
	{ID: "dd_byakuya", Class: game.Destroyer, Name: "白夜", Title: "沈まぬ太陽", Rarity: SR, Color: "#e0f0ff",
		Stats: st(265, 88, 275, 0, 34, 5, 34, 8, 3, 3, 10, 20),
		Intro: "白夜。私がいる限り、夜は来ないわ。", Attack: "終わりよ。",
		Home: []string{"眠れない夜は、海を眺めるの。", "私の探信音、聞こえた？"}},
	{ID: "dd_kagura", Class: game.Destroyer, Name: "神楽", Title: "舞い踊る刃", Rarity: SSR, Color: "#ff7eb6",
		Stats: st(280, 92, 300, 0, 30, 6, 36, 8, 4, 3, 13, 24),
		Intro: "神楽、舞います♪ 見惚れても知りませんよ？", Attack: "神楽の舞、とくとご覧あれ！",
		Home: []string{"戦いも舞も、リズムが大事です。", "提督、一緒に踊りませんか？"}},

	// ---- submarines: torpedo ----
	{ID: "ss_senryu", Class: game.Submarine, Name: "潜龍", Title: "深き海の牙", Rarity: N, Color: "#5c8aff",
		Stats: st(105, 0, 290, 0, 0, 0, 16, 0, 4, 2, 9, 10),
		Intro: "潜水艦、潜龍。こっそり行きます。", Attack: "魚雷、発射！",
		Home: []string{"潜航中の移動は、敵に気づかれないよ。", "水の中って落ち着くんだ。"}},
	{ID: "ss_miyuki", Class: game.Submarine, Name: "深雪", Title: "静かなる白", Rarity: R, Color: "#a0c4ff",
		Stats: st(110, 0, 305, 0, 0, 0, 17, 0, 4, 2, 12, 14),
		Intro: "深雪……です。よろしく、お願いします。", Attack: "……当たって。",
		Home: []string{"……静かなところ、好きです。", "水しぶきには映らないんです、私。"}},
	{ID: "ss_kaien", Class: game.Submarine, Name: "海燕", Title: "波間の稲妻", Rarity: SR, Color: "#3dd6c6",
		Stats: st(120, 0, 330, 0, 0, 0, 19, 0, 5, 2, 12, 14),
		Intro: "海燕、見参！魚雷の雨を降らせてやる！", Attack: "雷撃戦、開始！",
		Home: []string{"一直線に突き抜ける、それが魚雷だ！", "敵の真横を取れば勝ちだ。"}},
	{ID: "ss_ryugu", Class: game.Submarine, Name: "竜宮", Title: "海底の姫君", Rarity: SSR, Color: "#ff9ad5",
		Stats: st(130, 0, 350, 0, 0, 0, 18, 0, 5, 3, 15, 16),
		Intro: "竜宮へようこそ。……ふふ、帰さないわよ？", Attack: "海の底へ、ご招待♪",
		Home: []string{"玉手箱、開けてみる？", "時間を忘れるほど、遊びましょう？"}},

	// ---- carriers: airstrike ----
	{ID: "cv_kosame", Class: game.Carrier, Name: "小雨", Title: "雨上がりの翼", Rarity: N, Color: "#ffd08a",
		Stats: st(380, 40, 0, 300, 38, 10, 18, 2, 0, 4, 7, 5),
		Intro: "軽空母、小雨です。艦載機、がんばります！", Attack: "艦載機、発艦！",
		Home: []string{"航空攻撃は、海のどこでも届きます。", "雨の日も、空は飛べますよ。"}},
	{ID: "cv_hoyoku", Class: game.Carrier, Name: "鳳翼", Title: "紅の飛行甲板", Rarity: R, Color: "#ffb86b",
		Stats: st(395, 45, 0, 320, 40, 12, 20, 2, 0, 4, 8, 5),
		Intro: "空母、鳳翼。空は私たちのものよ。", Attack: "全機、突撃！",
		Home: []string{"遠くから狙えば、居場所はバレないわ。", "艦載機の子たち、可愛いでしょ？"}},
	{ID: "cv_amagi", Class: game.Carrier, Name: "天城", Title: "天翔ける城", Rarity: SR, Color: "#ff9f43",
		Stats: st(430, 50, 0, 340, 48, 13, 18, 3, 0, 4, 10, 5),
		Intro: "天城です。空からの守り、お任せください。", Attack: "攻撃隊、発艦始め！",
		Home: []string{"空を制する者が、海を制するのです。", "お茶でもいかがですか、提督。"}},
	{ID: "cv_houou", Class: game.Carrier, Name: "鳳凰", Title: "不死の炎翼", Rarity: SSR, Color: "#ff5e7e",
		Stats: st(450, 50, 0, 370, 52, 13, 21, 3, 0, 5, 12, 7),
		Intro: "鳳凰、ここに降臨。灰からでも、何度でも蘇るわ。", Attack: "炎の翼よ、舞い上がれ！",
		Home: []string{"不死鳥は伊達じゃないのよ。", "私の翼、触ってみる？……火傷するわよ。"}},
	{ID: "cv_amawashi", Class: game.Carrier, Name: "天鷲", Title: "天空の覇者", Rarity: UR, Color: "#7cf5ff",
		Stats: st(480, 55, 0, 390, 58, 14, 22, 3, 0, 5, 13, 8),
		Intro: "天鷲。空の果てまで、我が翼は届く。", Attack: "天より裁きを！",
		Home: []string{"空の上から見る海は、小さいものだ。", "提督、そなたの器を見せてもらおう。"}},
}

// st lists a ship's stats in table order: HP, firepower, torpedo, air,
// anti-air, armour %, speed, ammo, torpedoes, skill uses, crit %, evasion %.
func st(hp, fp, tp, air, aa, armor, speed, ammo, torps, skill, crit, evasion int) game.Stats {
	return game.Stats{HP: hp, Firepower: fp, Torpedo: tp, Air: air, AA: aa, Armor: armor, Speed: speed,
		Ammo: ammo, Torps: torps, Skill: skill, Crit: crit, Evasion: evasion}
}

var cardIndex = func() map[string]*Card {
	m := map[string]*Card{}
	for i := range Cards {
		m[Cards[i].ID] = &Cards[i]
	}
	return m
}()

func CardByID(id string) (*Card, bool) {
	c, ok := cardIndex[id]
	return c, ok
}

// StarterCards is the fleet every new admiral begins with, mirroring the original game.
var StarterCards = []string{"bb_kurogane", "dd_asanagi", "ss_senryu"}

// ---- enemies ----

// Enemy templates. Elite and boss variants are separate entries.
var Enemies = map[string]game.Spec{
	"e_dd":      {Class: game.Destroyer, Name: "黒鉄駆逐艦", Stats: st(200, 65, 200, 0, 20, 4, 30, 7, 2, 1, 5, 12)},
	"e_ss":      {Class: game.Submarine, Name: "黒鉄潜水艦", Stats: st(95, 0, 240, 0, 0, 0, 15, 0, 3, 1, 6, 10)},
	"e_ca":      {Class: game.Cruiser, Name: "黒鉄巡洋艦", Stats: st(380, 110, 170, 0, 40, 14, 20, 7, 2, 1, 6, 5)},
	"e_bb":      {Class: game.Battleship, Name: "黒鉄戦艦", Stats: st(600, 170, 0, 0, 35, 24, 10, 7, 0, 1, 6, 0)},
	"e_cv":      {Class: game.Carrier, Name: "黒鉄空母", Stats: st(360, 40, 0, 260, 35, 10, 15, 2, 0, 3, 6, 3)},
	"e_dd_el":   {Class: game.Destroyer, Name: "黒鉄駆逐艦 精鋭", Rarity: 1, Stats: st(260, 85, 260, 0, 26, 5, 34, 8, 3, 2, 10, 20)},
	"e_ss_el":   {Class: game.Submarine, Name: "黒鉄潜水艦 精鋭", Rarity: 1, Stats: st(125, 0, 310, 0, 0, 0, 17, 0, 4, 1, 12, 14)},
	"e_ca_el":   {Class: game.Cruiser, Name: "黒鉄巡洋艦 精鋭", Rarity: 1, Stats: st(440, 135, 210, 0, 50, 15, 24, 8, 2, 2, 12, 10)},
	"e_bb_el":   {Class: game.Battleship, Name: "黒鉄戦艦 精鋭", Rarity: 1, Stats: st(700, 205, 0, 0, 45, 26, 12, 8, 0, 2, 10, 0)},
	"e_cv_el":   {Class: game.Carrier, Name: "黒鉄空母 精鋭", Rarity: 1, Stats: st(420, 50, 0, 320, 45, 12, 18, 2, 0, 4, 12, 5)},
	"boss_wall": {Class: game.Battleship, Name: "前衛旗艦《アイアンウォール》", Boss: true, Rarity: 2, Stats: st(850, 175, 0, 0, 45, 28, 10, 9, 0, 2, 6, 0)},
	"boss_wing": {Class: game.Carrier, Name: "空母旗艦《ナイトウィング》", Boss: true, Rarity: 2, Stats: st(820, 50, 0, 330, 60, 15, 18, 3, 0, 6, 12, 5)},
	"boss_ice":  {Class: game.Cruiser, Name: "氷海旗艦《ブリザード》", Boss: true, Rarity: 3, Stats: st(980, 160, 240, 0, 60, 20, 26, 9, 3, 3, 14, 10)},
	"boss_lev":  {Class: game.Battleship, Name: "深淵旗艦《リヴァイアサン》", Boss: true, Rarity: 4, Stats: st(1400, 250, 0, 0, 70, 30, 12, 11, 0, 3, 15, 0)},
}

func enemySpecs(keys []string) []game.Spec {
	out := make([]game.Spec, len(keys))
	for i, k := range keys {
		sp, ok := Enemies[k]
		if !ok {
			panic("unknown enemy " + k)
		}
		sp.Key = k
		out[i] = sp
	}
	return out
}

// ---- campaign ----

type Area struct {
	No    int    `json:"no"`
	Name  string `json:"name"`
	Theme string `json:"theme"`
}

var Areas = []Area{
	{1, "鎮守府近海", "dawn"},
	{2, "南西諸島沖", "tropic"},
	{3, "北方氷海", "ice"},
	{4, "深淵海域", "abyss"},
}

type Stage struct {
	ID        string   `json:"id"`
	Area      int      `json:"area"`
	No        int      `json:"no"`
	Name      string   `json:"name"`
	Brief     string   `json:"brief"`
	Size      int      `json:"size"`
	MaxTurns  int      `json:"maxTurns"`
	StarTurns int      `json:"starTurns"` // clear within this many turns for the second star
	AI        int      `json:"ai"`
	Enemies   []string `json:"enemies"`
	Boss      bool     `json:"boss,omitempty"`
	Coins     int      `json:"coins"`
	Exp       int      `json:"exp"`
	FirstGems int      `json:"firstGems"`
	// DropRate is the percent chance a win drops a card; DropWeights by rarity N..UR.
	DropRate    int    `json:"dropRate"`
	DropWeights [5]int `json:"dropWeights"`
	// Floor is set on generated endless stages.
	Floor int `json:"floor,omitempty"`
}

func (s Stage) EnemySpecs() []game.Spec { return enemySpecs(s.Enemies) }

var Stages = []Stage{
	{ID: "1-1", Area: 1, No: 1, Name: "近海哨戒", Brief: "鎮守府近海に敵の小艦隊が出没。まずは肩慣らしだ。",
		Size: 5, MaxTurns: 16, StarTurns: 8, Enemies: []string{"e_dd", "e_ss"},
		Coins: 300, Exp: 50, FirstGems: 100, DropRate: 40, DropWeights: [5]int{80, 20, 0, 0, 0}},
	{ID: "1-2", Area: 1, No: 2, Name: "港湾防衛線", Brief: "港へ迫る駆逐艦隊を迎え撃て。",
		Size: 5, MaxTurns: 18, StarTurns: 9, Enemies: []string{"e_dd", "e_dd", "e_ss"},
		Coins: 400, Exp: 60, FirstGems: 100, DropRate: 40, DropWeights: [5]int{70, 28, 2, 0, 0}},
	{ID: "1-3", Area: 1, No: 3, Name: "敵輸送船団", Brief: "巡洋艦に護衛された船団を捕捉した。",
		Size: 5, MaxTurns: 18, StarTurns: 9, AI: 1, Enemies: []string{"e_ca", "e_dd", "e_ss"},
		Coins: 500, Exp: 70, FirstGems: 120, DropRate: 45, DropWeights: [5]int{60, 34, 6, 0, 0}},
	{ID: "1-4", Area: 1, No: 4, Name: "鉄の壁", Brief: "敵前衛旗艦《アイアンウォール》出現！全力で撃滅せよ！", Boss: true,
		Size: 5, MaxTurns: 20, StarTurns: 10, AI: 1, Enemies: []string{"boss_wall", "e_dd", "e_ss"},
		Coins: 800, Exp: 110, FirstGems: 300, DropRate: 70, DropWeights: [5]int{30, 50, 17, 3, 0}},

	{ID: "2-1", Area: 2, No: 1, Name: "珊瑚礁の追撃", Brief: "広い海域では索敵がものを言う。",
		Size: 6, MaxTurns: 20, StarTurns: 9, AI: 1, Enemies: []string{"e_ca", "e_dd", "e_dd"},
		Coins: 600, Exp: 90, FirstGems: 150, DropRate: 45, DropWeights: [5]int{55, 37, 8, 0, 0}},
	{ID: "2-2", Area: 2, No: 2, Name: "空襲警報", Brief: "敵空母は海域のどこへでも爆撃してくる。早期発見を！",
		Size: 6, MaxTurns: 20, StarTurns: 10, AI: 1, Enemies: []string{"e_cv", "e_dd", "e_ss"},
		Coins: 650, Exp: 95, FirstGems: 150, DropRate: 45, DropWeights: [5]int{50, 40, 10, 0, 0}},
	{ID: "2-3", Area: 2, No: 3, Name: "戦艦の影", Brief: "敵戦艦を含む打撃群。一斉射に注意せよ。",
		Size: 6, MaxTurns: 22, StarTurns: 11, AI: 2, Enemies: []string{"e_bb", "e_ca", "e_ss"},
		Coins: 750, Exp: 110, FirstGems: 180, DropRate: 50, DropWeights: [5]int{45, 42, 12, 1, 0}},
	{ID: "2-4", Area: 2, No: 4, Name: "夜翼の襲来", Brief: "空母旗艦《ナイトウィング》率いる機動部隊を叩け！", Boss: true,
		Size: 6, MaxTurns: 24, StarTurns: 13, AI: 2, Enemies: []string{"boss_wing", "e_ca", "e_dd", "e_ss"},
		Coins: 1200, Exp: 160, FirstGems: 400, DropRate: 75, DropWeights: [5]int{20, 50, 24, 6, 0}},

	{ID: "3-1", Area: 3, No: 1, Name: "流氷の迷路", Brief: "精鋭艦が姿を現し始めた。気を引き締めよ。",
		Size: 6, MaxTurns: 22, StarTurns: 10, AI: 2, Enemies: []string{"e_dd_el", "e_ca", "e_ss"},
		Coins: 900, Exp: 130, FirstGems: 200, DropRate: 50, DropWeights: [5]int{40, 44, 14, 2, 0}},
	{ID: "3-2", Area: 3, No: 2, Name: "氷下の狩人", Brief: "精鋭潜水艦が潜む海域。ソナーで炙り出せ。",
		Size: 6, MaxTurns: 22, StarTurns: 11, AI: 2, Enemies: []string{"e_ss_el", "e_ss", "e_dd", "e_ca"},
		Coins: 950, Exp: 140, FirstGems: 200, DropRate: 50, DropWeights: [5]int{38, 45, 15, 2, 0}},
	{ID: "3-3", Area: 3, No: 3, Name: "白銀の砲火", Brief: "精鋭戦艦と空母の連合艦隊。",
		Size: 6, MaxTurns: 24, StarTurns: 12, AI: 3, Enemies: []string{"e_bb_el", "e_cv", "e_dd", "e_ss"},
		Coins: 1050, Exp: 150, FirstGems: 250, DropRate: 55, DropWeights: [5]int{35, 45, 17, 3, 0}},
	{ID: "3-4", Area: 3, No: 4, Name: "吹雪の女王", Brief: "氷海旗艦《ブリザード》の照明弾から逃れる術はあるか。", Boss: true,
		Size: 6, MaxTurns: 26, StarTurns: 14, AI: 3, Enemies: []string{"boss_ice", "e_ca_el", "e_dd", "e_ss_el"},
		Coins: 1600, Exp: 220, FirstGems: 500, DropRate: 80, DropWeights: [5]int{10, 45, 35, 9, 1}},

	{ID: "4-1", Area: 4, No: 1, Name: "深淵への門", Brief: "最終海域。広大な海に精鋭が潜む。",
		Size: 7, MaxTurns: 24, StarTurns: 11, AI: 3, Enemies: []string{"e_ca_el", "e_dd_el", "e_ss_el"},
		Coins: 1300, Exp: 190, FirstGems: 300, DropRate: 55, DropWeights: [5]int{30, 45, 20, 5, 0}},
	{ID: "4-2", Area: 4, No: 2, Name: "闇夜の空母群", Brief: "精鋭空母二隻による波状爆撃。",
		Size: 7, MaxTurns: 26, StarTurns: 13, AI: 3, Enemies: []string{"e_cv_el", "e_cv", "e_dd_el", "e_ss"},
		Coins: 1400, Exp: 200, FirstGems: 300, DropRate: 55, DropWeights: [5]int{28, 45, 21, 6, 0}},
	{ID: "4-3", Area: 4, No: 3, Name: "決戦前夜", Brief: "旗艦を守る最精鋭の打撃群。",
		Size: 7, MaxTurns: 28, StarTurns: 15, AI: 3, Enemies: []string{"e_bb_el", "e_ca_el", "e_dd_el", "e_ss_el"},
		Coins: 1600, Exp: 230, FirstGems: 350, DropRate: 60, DropWeights: [5]int{25, 45, 23, 7, 0}},
	{ID: "4-4", Area: 4, No: 4, Name: "深淵の王", Brief: "深淵旗艦《リヴァイアサン》。全てを賭けて挑め！", Boss: true,
		Size: 7, MaxTurns: 30, StarTurns: 16, AI: 3, Enemies: []string{"boss_lev", "e_bb_el", "e_cv_el", "e_ss_el"},
		Coins: 2500, Exp: 350, FirstGems: 1000, DropRate: 100, DropWeights: [5]int{0, 40, 40, 16, 4}},
}

// EndlessID is the endless-mode stage, unlocked after the campaign.
const EndlessID = "ex"

var endlessPool = [][]string{
	{"e_dd", "e_ss", "e_ca"},
	{"e_bb", "e_dd_el", "e_ss"},
	{"e_cv", "e_ca_el", "e_ss_el"},
	{"e_bb_el", "e_cv_el", "e_dd_el", "e_ss_el"},
}

var endlessBosses = []string{"boss_wall", "boss_wing", "boss_ice", "boss_lev"}

// EndlessStage generates floor n (1-based) of the endless sea. Every fifth floor is a boss.
func EndlessStage(floor int) Stage {
	tier := min((floor-1)/5, len(endlessPool)-1)
	enemies := append([]string{}, endlessPool[tier]...)
	boss := floor%5 == 0
	if boss {
		enemies[0] = endlessBosses[min((floor/5)-1, len(endlessBosses)-1)]
	}
	size := min(5+floor/4, 7)
	st := Stage{
		ID: EndlessID, Area: 5, No: floor, Floor: floor, Boss: boss,
		Name:     fmt.Sprintf("無限海域 第%d層", floor),
		Brief:    "果てなき深淵の海。どこまで潜れるか。",
		Size:     size,
		MaxTurns: 18 + size, StarTurns: 5 + size, AI: min(1+floor/3, 3),
		Enemies: enemies,
		Coins:   800 + floor*150, Exp: 120 + floor*20, FirstGems: 0,
		DropRate: min(40+floor*3, 90), DropWeights: [5]int{max(40-floor*2, 5), 40, 15 + floor, 4 + floor/3, 1 + floor/10},
	}
	if boss {
		st.FirstGems = 200 + floor*20
	}
	return st
}

var stageIndex = func() map[string]*Stage {
	m := map[string]*Stage{}
	for i := range Stages {
		m[Stages[i].ID] = &Stages[i]
	}
	return m
}()

func StageByID(id string) (*Stage, bool) {
	s, ok := stageIndex[id]
	return s, ok
}

// ---- progression tables ----

// ExpToNext is the admiral experience needed to go from lv to lv+1.
func ExpToNext(lv int) int { return 80 + 40*lv }

// ShipExpToNext is the ship experience needed to go from lv to lv+1.
func ShipExpToNext(lv int) int { return 20 * lv }

// ShipMaxLevel grows with limit breaks.
func ShipMaxLevel(stars int) int { return 20 + 6*stars }

// LevelUpCost is the coin price of training a ship from lv to lv+1.
func LevelUpCost(lv int) int { return 40 * lv }

const MaxStars = 5

// FleetSlots is how many ships the admiral may deploy.
func FleetSlots(level int) int {
	if level >= 4 {
		return 4
	}
	return 3
}

// ---- gacha ----

const (
	PullCost    = 100
	TenPullCost = 1000
	PityPulls   = 60 // SSR or better guaranteed by this pull
)

// OverflowCoins is the coin compensation, by rarity, for a duplicate of a fully
// limit-broken ship. It pays coins rather than gems so duplicates do not fund more pulls.
var OverflowCoins = [5]int{300, 500, 1000, 2000, 4000}

// PullRates are per-mille weights for N..UR.
var PullRates = [5]int{400, 350, 180, 60, 10}
