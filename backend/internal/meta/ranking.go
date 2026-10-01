package meta

// Rankings order every named admiral on a few boards. The store keeps each
// admiral's Scores beside the profile so a board is an index scan, not a
// pass over every profile.
const (
	// RankingSize is how many admirals a board lists from the top.
	RankingSize = 100
	// ScoresVersion changes whenever Scores would come out differently for
	// the same profile (say, a new Power formula), so stored scores are
	// worked out again.
	ScoresVersion = 1
)

// Board is one ranking.
type Board string

const (
	BoardLevel   Board = "level"   // admiral level, then experience
	BoardPower   Board = "power"   // fleet power of the formation
	BoardWins    Board = "wins"    // battles won
	BoardEndless Board = "endless" // deepest endless floor cleared
)

var Boards = []Board{BoardLevel, BoardPower, BoardWins, BoardEndless}

func (b Board) Valid() bool {
	for _, x := range Boards {
		if b == x {
			return true
		}
	}
	return false
}

// Scores are what the boards rank an admiral by. Admirals who have yet to
// choose a name stay off every board.
type Scores struct {
	Ranked     bool
	Level      int
	Exp        int
	FleetPower int
	Wins       int
	Endless    int
}

func (p *Profile) Scores() Scores {
	return Scores{
		Ranked: !p.Unnamed, Level: p.Level, Exp: p.Exp, FleetPower: p.FleetPower(),
		Wins: p.Stats.Wins, Endless: p.Endless,
	}
}

// FleetPower sums the power of the ships in formation.
func (p *Profile) FleetPower() int {
	n := 0
	for _, u := range p.Fleet {
		if s := p.Ship(u); s != nil {
			n += Power(s.Spec())
		}
	}
	return n
}

// RankEntry is one admiral on a board. Other admirals are shown by name
// only; their ids and friend codes stay private.
type RankEntry struct {
	Rank    int    `json:"rank"`
	Score   int    `json:"score"`
	Name    string `json:"name"`
	Comment string `json:"comment"`
	Level   int    `json:"level"`
	// Secretary is the card of the admiral's secretary ship.
	Secretary string `json:"secretary"`
	Me        bool   `json:"me,omitempty"`
	Friend    bool   `json:"friend,omitempty"`
}

// Ranking is a board's top admirals, how many are on it, and where the
// asking admiral stands (Me.Rank is 0 when they are not on it).
type Ranking struct {
	Board   Board       `json:"board"`
	Entries []RankEntry `json:"entries"`
	Total   int         `json:"total"`
	Me      RankEntry   `json:"me"`
}
