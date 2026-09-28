package game

// ShipView is a ship as seen by the player. Pos is nil for hidden enemy ships.
type ShipView struct {
	ID            int       `json:"id"`
	Class         ShipClass `json:"class"`
	Name          string    `json:"name"`
	HP            int       `json:"hp"`
	MaxHP         int       `json:"maxHp"`
	Ammo          int       `json:"ammo"`
	MaxAmmo       int       `json:"maxAmmo"`
	Pos           *Pos      `json:"pos,omitempty"`
	AttackTargets []Pos     `json:"attackTargets,omitempty"`
	MoveTargets   []Pos     `json:"moveTargets,omitempty"`
}

type View struct {
	BoardSize   int        `json:"boardSize"`
	Turn        int        `json:"turn"`
	Status      Status     `json:"status"`
	Winner      Side       `json:"winner,omitempty"`
	PlayerShips []ShipView `json:"playerShips"`
	EnemyShips  []ShipView `json:"enemyShips"`
	History     []Result   `json:"history"`
}

// PlayerView renders the state from the player's perspective; enemy positions
// are revealed only once the game is over.
func (st *State) PlayerView() View {
	v := View{
		BoardSize: BoardSize,
		Turn:      st.Turn,
		Status:    st.Status,
		Winner:    st.Winner,
		History:   st.History,
	}
	inProgress := st.Status == StatusInProgress
	player, cpu := st.Boards[SidePlayer], st.Boards[SideCPU]
	for _, s := range player.Ships {
		sv := shipView(s)
		if inProgress {
			sv.AttackTargets = player.AttackTargets(s.ID)
			sv.MoveTargets = player.MoveTargets(s.ID)
		}
		v.PlayerShips = append(v.PlayerShips, sv)
	}
	for _, s := range cpu.Ships {
		sv := shipView(s)
		if inProgress {
			sv.Pos = nil
		}
		v.EnemyShips = append(v.EnemyShips, sv)
	}
	return v
}

func shipView(s *Ship) ShipView {
	spec := s.Spec()
	p := s.Pos
	return ShipView{
		ID: s.ID, Class: spec.Class, Name: spec.Name,
		HP: s.HP, MaxHP: spec.HP, Ammo: s.Ammo, MaxAmmo: spec.Ammo,
		Pos: &p,
	}
}
