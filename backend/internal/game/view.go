package game

// ShipView is a ship as seen by the player. Pos is nil for enemy ships the
// player has no intel on; Spotted marks enemy positions that come from intel.
type ShipView struct {
	ID        int       `json:"id"`
	Key       string    `json:"key"`
	Class     ShipClass `json:"class"`
	Name      string    `json:"name"`
	Rarity    int       `json:"rarity"`
	Boss      bool      `json:"boss,omitempty"`
	HP        int       `json:"hp"`
	MaxHP     int       `json:"maxHp"`
	Ammo      int       `json:"ammo"`
	MaxAmmo   int       `json:"maxAmmo"`
	Torps     int       `json:"torps"`
	MaxTorps  int       `json:"maxTorps"`
	SkillKind SkillKind `json:"skillKind"`
	Skill     int       `json:"skill"`
	MaxSkill  int       `json:"maxSkill"`
	Firepower int       `json:"firepower"`
	Torpedo   int       `json:"torpedo"`
	Air       int       `json:"air"`
	AA        int       `json:"aa"`
	Armor     int       `json:"armor"`
	Speed     int       `json:"speed"`
	Crit      int       `json:"crit"`
	Evasion   int       `json:"evasion"`
	GunRange  int       `json:"gunRange"`
	MoveRange int       `json:"moveRange"`
	// Pinned: a water column holds the ship this round. Shown for enemy ships only while spotted.
	Pinned bool `json:"pinned,omitempty"`
	// Marked: a scouting skill has locked on to the ship. Shown for enemy ships only while spotted.
	Marked bool `json:"marked,omitempty"`
	// UnderWay: the ship moved last round, so moving again resolves late.
	UnderWay    bool `json:"underWay,omitempty"`
	Pos         *Pos `json:"pos,omitempty"`
	Spotted     bool `json:"spotted,omitempty"`
	SpottedTurn int  `json:"spottedTurn,omitempty"`

	AttackTargets  []Pos `json:"attackTargets,omitempty"`
	TorpedoTargets []Pos `json:"torpedoTargets,omitempty"`
	MoveTargets    []Pos `json:"moveTargets,omitempty"`
	SkillTargets   []Pos `json:"skillTargets,omitempty"`
}

type View struct {
	BoardSize  int       `json:"boardSize"`
	Turn       int       `json:"turn"`
	MaxTurns   int       `json:"maxTurns"`
	Weather    Weather   `json:"weather"`
	Status     Status    `json:"status"`
	Winner     Side      `json:"winner,omitempty"`
	EndReason  EndReason `json:"endReason,omitempty"`
	Gauge      int       `json:"gauge"`
	EnemyGauge int       `json:"enemyGauge"`
	Combo      int       `json:"combo"`
	MaxCombo   int       `json:"maxCombo"`
	// AA is each fleet's anti-air total, which weakens the other side's airstrikes.
	AA      int `json:"aa"`
	EnemyAA int `json:"enemyAa"`
	// LastGun is where the player's previous action fired; guns aimed there again get spotting fire.
	LastGun     *Pos       `json:"lastGun,omitempty"`
	PlayerShips []ShipView `json:"playerShips"`
	EnemyShips  []ShipView `json:"enemyShips"`
	History     []Result   `json:"history"`
}

// PlayerView renders the state from the player's perspective; enemy positions
// are revealed through intel, and fully once the game is over.
func (st *State) PlayerView() View { return st.ViewFor(SidePlayer) }

// ViewFor renders the state from side me's perspective. The second admiral of
// a duel (SideCPU) gets it mirrored, so that each admiral sees their own
// fleet as "player" and their own deployment zone at the bottom of the sea.
func (st *State) ViewFor(me Side) View {
	st.syncWeather()
	own, foe := st.Boards[me], st.Boards[me.Opponent()]
	v := View{
		BoardSize:  st.Size,
		Turn:       st.Turn,
		MaxTurns:   st.MaxTurns,
		Weather:    st.Weather,
		Status:     st.Status,
		Winner:     st.Winner,
		EndReason:  st.EndReason,
		Gauge:      st.Gauge[me],
		EnemyGauge: st.Gauge[me.Opponent()],
		Combo:      st.Combo[me],
		MaxCombo:   st.MaxCombo[me],
		AA:         own.AA(),
		EnemyAA:    foe.AA(),
		LastGun:    st.LastGun[me],
		History:    st.History,
	}
	inProgress := st.Status == StatusInProgress
	for _, s := range own.Ships {
		sv := shipView(s, own)
		sv.Pinned = s.Pinned > 0 && s.Alive()
		sv.UnderWay = s.Sailed > 0 && s.Alive()
		sv.Marked = s.Marked > 0 && s.Alive()
		if inProgress {
			sv.AttackTargets = own.AttackTargets(s.ID)
			sv.TorpedoTargets = own.TorpedoTargets(s.ID)
			sv.MoveTargets = own.MoveTargets(s.ID)
			sv.SkillTargets = own.SkillTargets(s.ID)
		}
		v.PlayerShips = append(v.PlayerShips, sv)
	}
	for _, s := range foe.Ships {
		sv := shipView(s, foe)
		if inProgress && s.Alive() {
			sv.Pos = nil
			if seen, ok := st.Intel[me][key(s.ID)]; ok {
				p := seen.Pos
				sv.Pos, sv.Spotted, sv.SpottedTurn = &p, true, seen.Turn
				sv.Pinned = s.Pinned > 0
				sv.Marked = s.Marked > 0
			}
			// Every move is announced, so whether a ship is under way is public.
			sv.UnderWay = s.Sailed > 0
		}
		v.EnemyShips = append(v.EnemyShips, sv)
	}
	if me == SideCPU {
		v = v.mirrored()
	}
	return v
}

func shipView(s *Ship, b *Board) ShipView {
	sp := s.Spec
	p := s.Pos
	return ShipView{
		ID: s.ID, Key: sp.Key, Class: sp.Class, Name: sp.Name, Rarity: sp.Rarity, Boss: sp.Boss,
		HP: s.HP, MaxHP: sp.HP, Ammo: s.Ammo, MaxAmmo: sp.Ammo, Torps: s.Torps, MaxTorps: sp.Torps,
		SkillKind: sp.SkillKind(), Skill: s.Skill, MaxSkill: sp.Skill,
		Firepower: sp.Firepower, Torpedo: sp.Torpedo, Air: sp.Air, AA: sp.AA, Armor: sp.Armor, Speed: sp.Speed,
		Crit: sp.Crit, Evasion: sp.Evasion, GunRange: sp.Rule().GunRange, MoveRange: b.MoveRange(s),
		Pos: &p,
	}
}
