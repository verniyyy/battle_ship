package game

import "strconv"

// ShipView is a ship as seen by the player. Pos is nil for enemy ships the
// player has no intel on; Spotted marks enemy positions that come from intel.
type ShipView struct {
	ID          int       `json:"id"`
	Key         string    `json:"key"`
	Class       ShipClass `json:"class"`
	Name        string    `json:"name"`
	Rarity      int       `json:"rarity"`
	Boss        bool      `json:"boss,omitempty"`
	HP          int       `json:"hp"`
	MaxHP       int       `json:"maxHp"`
	Ammo        int       `json:"ammo"`
	MaxAmmo     int       `json:"maxAmmo"`
	SkillKind   SkillKind `json:"skillKind"`
	Skill       int       `json:"skill"`
	MaxSkill    int       `json:"maxSkill"`
	Crit        int       `json:"crit"`
	Evasion     int       `json:"evasion"`
	Pos         *Pos      `json:"pos,omitempty"`
	Spotted     bool      `json:"spotted,omitempty"`
	SpottedTurn int       `json:"spottedTurn,omitempty"`

	AttackTargets []Pos `json:"attackTargets,omitempty"`
	MoveTargets   []Pos `json:"moveTargets,omitempty"`
	SkillTargets  []Pos `json:"skillTargets,omitempty"`
}

type View struct {
	BoardSize   int        `json:"boardSize"`
	Turn        int        `json:"turn"`
	MaxTurns    int        `json:"maxTurns"`
	Status      Status     `json:"status"`
	Winner      Side       `json:"winner,omitempty"`
	EndReason   EndReason  `json:"endReason,omitempty"`
	Gauge       int        `json:"gauge"`
	EnemyGauge  int        `json:"enemyGauge"`
	Combo       int        `json:"combo"`
	MaxCombo    int        `json:"maxCombo"`
	PlayerShips []ShipView `json:"playerShips"`
	EnemyShips  []ShipView `json:"enemyShips"`
	History     []Result   `json:"history"`
}

// PlayerView renders the state from the player's perspective; enemy positions
// are revealed through intel, and fully once the game is over.
func (st *State) PlayerView() View {
	v := View{
		BoardSize:  st.Size,
		Turn:       st.Turn,
		MaxTurns:   st.MaxTurns,
		Status:     st.Status,
		Winner:     st.Winner,
		EndReason:  st.EndReason,
		Gauge:      st.Gauge[SidePlayer],
		EnemyGauge: st.Gauge[SideCPU],
		Combo:      st.Combo[SidePlayer],
		MaxCombo:   st.MaxCombo[SidePlayer],
		History:    st.History,
	}
	inProgress := st.Status == StatusInProgress
	player, cpu := st.Boards[SidePlayer], st.Boards[SideCPU]
	for _, s := range player.Ships {
		sv := shipView(s)
		if inProgress {
			sv.AttackTargets = player.AttackTargets(s.ID)
			sv.MoveTargets = player.MoveTargets(s.ID)
			sv.SkillTargets = player.SkillTargets(s.ID)
		}
		v.PlayerShips = append(v.PlayerShips, sv)
	}
	for _, s := range cpu.Ships {
		sv := shipView(s)
		if inProgress && s.Alive() {
			sv.Pos = nil
			if seen, ok := st.Intel[SidePlayer][strconv.Itoa(s.ID)]; ok {
				p := seen.Pos
				sv.Pos, sv.Spotted, sv.SpottedTurn = &p, true, seen.Turn
			}
		}
		v.EnemyShips = append(v.EnemyShips, sv)
	}
	return v
}

func shipView(s *Ship) ShipView {
	sp := s.Spec
	p := s.Pos
	return ShipView{
		ID: s.ID, Key: sp.Key, Class: sp.Class, Name: sp.Name, Rarity: sp.Rarity, Boss: sp.Boss,
		HP: s.HP, MaxHP: sp.HP, Ammo: s.Ammo, MaxAmmo: sp.Ammo,
		SkillKind: sp.SkillKind(), Skill: s.Skill, MaxSkill: sp.Skill,
		Crit: sp.Crit, Evasion: sp.Evasion,
		Pos: &p,
	}
}
